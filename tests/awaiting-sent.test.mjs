// «Ordine a X inviato alle 10:42: è partito?» (owner, 14 Nov 2026) — the question every device
// shows once an order has been handed to WhatsApp. The rule is js/orders/awaiting-sent.js (pure);
// its writes are js/orders/draft.js, EXECUTED here with the data layer replaced by
// tests/helpers/firebase-orders-recording-stub.mjs, whose claim behaves as Firestore's
// transaction would: read, decide, delete — one claim at a time.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { draft, stub } from './helpers/load-draft.mjs';
import {
  awaitingEntry, draftQuantities, isAwaiting, awaitingList, claimDecision, linesToClear,
  supplierKeepsLines, answerAwaiting,
} from '../js/orders/awaiting-sent.js';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

beforeEach(() => { stub.reset(); });

const AT = '2026-11-14T10:42:00.000Z';
const SENT = { at: AT, date: '2026-11-14', quantities: { flour: 2, yeast: 1 }, units: { flour: 'cartone' } };

// ── the value written ────────────────────────────────────────────────────────

test('the entry keeps only the lines that went, with their unit, the day and the time', () => {
  assert.deepEqual(awaitingEntry({ at: AT, date: '2026-11-14',
    quantities: { flour: '2', salt: 0, yeast: 1, junk: 'x' }, units: { flour: ' cartone ', salt: 'kg' } }),
  { at: AT, date: '2026-11-14', quantities: { flour: 2, yeast: 1 }, units: { flour: 'cartone' } });
  assert.equal(awaitingEntry({ at: AT, quantities: { flour: 0 } }), null, 'nothing went: nothing to ask');
  assert.equal(awaitingEntry({ at: AT, date: 'yesterday', quantities: { a: 1 } }).date, '', 'a day is a day or nothing');
});

test('the header send stores the draft as the message read it, in the unit every row shows', () => {
  const ingredients = [
    { id: 'flour', unit: 'sacco', packUnit: 'busta' },
    { id: 'yeast', unit: 'kg' },
    { id: 'salt', unit: 'kg' },
  ];
  const entries = { flour: { qty: 2, unit: 'busta' }, yeast: { qty: 1 }, salt: { qty: 0, stock: 4 } };
  assert.deepEqual(draftQuantities(ingredients, entries),
    { quantities: { flour: 2, yeast: 1 }, units: { flour: 'busta', yeast: 'kg' } });
});

test('only a well-formed question is shown, one per supplier the venue still has, oldest first', () => {
  const suppliers = [{ id: 'A' }, { id: 'B' }];
  const list = awaitingList({
    B: { ...SENT, at: '2026-11-14T09:00:00.000Z' },
    A: SENT,
    gone: SENT,                               // a supplier deleted since
    broken: { at: AT },                       // no quantities
  }, suppliers);
  assert.deepEqual(list.map(e => e.supplier.id), ['B', 'A']);
  assert.equal(isAwaiting({ at: AT, quantities: { a: 0 } }), false);
  assert.equal(isAwaiting(null), false);
});

// ── «Sì» clears only what went ────────────────────────────────────────────────

test('⚠️ «Sì» clears the lines that went and still read so — typing done since stays', () => {
  const cards = { flour: { id: 'flour', unit: 'sacco', packUnit: 'cartone' }, yeast: { id: 'yeast', unit: 'kg' }, salt: { id: 'salt', unit: 'kg' } };
  const entries = {
    flour: { qty: 2, unit: 'cartone' },      // as sent → cleared
    yeast: { qty: 3 },                        // changed since (1 → 3) → stays
    salt: { qty: 5 },                         // typed after the send → stays
  };
  const cleared = linesToClear(entries, id => cards[id], SENT);
  assert.deepEqual(cleared, ['flour']);
  assert.equal(supplierKeepsLines(Object.values(cards), entries, cleared), true, 'the day stamp stays with them');
});

test('a line whose UNIT changed since is not cleared; a line with no unit compares with the card', () => {
  const cards = { flour: { id: 'flour', unit: 'sacco', packUnit: 'cartone' }, yeast: { id: 'yeast', unit: 'kg' } };
  assert.deepEqual(linesToClear({ flour: { qty: 2, unit: 'sacco' }, yeast: { qty: 1, unit: 'kg' } }, id => cards[id], SENT), ['yeast']);
  assert.equal(supplierKeepsLines(Object.values(cards), { flour: { qty: 2 } }, ['flour']), false);
});

// ── answering ─────────────────────────────────────────────────────────────────

function device(record = async () => true) {
  const log = { claims: 0, records: [], restored: [], dropped: [] };
  const deps = {
    busy: new Set(),
    claim: async (id, at) => { log.claims++; return draft.claimAwaitingSent(id, at, claimDecision); },
    record: async (id, entry) => { log.records.push({ id, entry }); return record(id, entry); },
    restore: async (id, entry) => { log.restored.push(id); stub.server.draft.awaitingSent[id] = entry; },
    drop: async id => { log.dropped.push(id); await draft.clearAwaitingSent(id); },
  };
  return { deps, log };
}
const serverHas = id => Boolean(stub.server.draft?.awaitingSent?.[id]);

test('⚠️ «Sì» records ONCE, with the STORED quantities, then the key is gone', async () => {
  stub.server.draft = { entries: { flour: { qty: 9 } }, awaitingSent: { S1: structuredClone(SENT) } };
  const phone = device();
  assert.equal(await answerAwaiting('yes', 'S1', SENT, phone.deps), 'recorded');
  assert.equal(phone.log.records.length, 1);
  assert.deepEqual(phone.log.records[0].entry.quantities, { flour: 2, yeast: 1 }, 'what WENT, not the draft’s 9');
  assert.deepEqual(phone.log.records[0].entry.units, { flour: 'cartone' });
  assert.equal(serverHas('S1'), false);
  assert.deepEqual(stub.calls.clearFieldsIf[0].paths, ['awaitingSent.S1'], 'the claim touches that one key only');
});

test('⚠️⚠️ «Sì» on two devices at the same moment records once: the second hears it was answered', async () => {
  stub.server.draft = { awaitingSent: { S1: structuredClone(SENT) } };
  const tablet = device();
  const phone = device();
  const both = await Promise.all([
    answerAwaiting('yes', 'S1', SENT, tablet.deps),
    answerAwaiting('yes', 'S1', SENT, phone.deps),
  ]);
  assert.deepEqual(both.sort(), ['elsewhere', 'recorded']);
  assert.equal(tablet.log.records.length + phone.log.records.length, 1, 'mergeArchives ADDS: twice would double the order');
});

test('a double tap on ONE device: the second does nothing while the first is answering', async () => {
  stub.server.draft = { awaitingSent: { S1: structuredClone(SENT) } };
  const phone = device();
  const [first, second] = await Promise.all([
    answerAwaiting('yes', 'S1', SENT, phone.deps),
    answerAwaiting('yes', 'S1', SENT, phone.deps),
  ]);
  assert.equal(first, 'recorded');
  assert.equal(second, 'busy');
  assert.equal(phone.log.claims, 1);
});

test('a newer send for the same supplier is not claimed by an answer to the older one', async () => {
  stub.server.draft = { awaitingSent: { S1: { ...structuredClone(SENT), at: '2026-11-14T11:00:00.000Z' } } };
  const phone = device();
  assert.equal(await answerAwaiting('yes', 'S1', SENT, phone.deps), 'elsewhere');
  assert.equal(phone.log.records.length, 0);
  assert.equal(serverHas('S1'), true, 'the newer question still waits');
});

test('⚠️ «No» only removes the key: nothing claimed, nothing recorded', async () => {
  stub.server.draft = { awaitingSent: { S1: structuredClone(SENT) } };
  const phone = device();
  assert.equal(await answerAwaiting('no', 'S1', SENT, phone.deps), 'dropped');
  assert.equal(phone.log.claims, 0);
  assert.equal(phone.log.records.length, 0);
  assert.deepEqual(stub.calls.clearFields.map(c => c.paths), [['awaitingSent.S1']], 'that one key, no row touched');
});

test('a recording that fails puts the question back, so the order is still asked about', async () => {
  stub.server.draft = { awaitingSent: { S1: structuredClone(SENT) } };
  const phone = device(async () => false);
  assert.equal(await answerAwaiting('yes', 'S1', SENT, phone.deps), 'failed');
  assert.deepEqual(phone.log.restored, ['S1']);
  assert.equal(serverHas('S1'), true);
});

test('a claim that cannot be made (no network) records nothing and leaves the question', async () => {
  const phone = device();
  phone.deps.claim = async () => { throw new Error('unavailable'); };
  assert.equal(await answerAwaiting('yes', 'S1', SENT, phone.deps), 'claimFailed');
  assert.equal(phone.log.records.length, 0);
});

test('a question this device could not share is recorded straight away, once', async () => {
  const phone = device();
  assert.equal(await answerAwaiting('yes', 'S1', SENT, phone.deps, { local: true }), 'recorded');
  assert.equal(phone.log.claims, 0);
  assert.equal(phone.log.records.length, 1);
});

// ── the writes ────────────────────────────────────────────────────────────────

test('⚠️ the question is written WHOLE for that supplier — a mergeFields write, never a deep merge', async () => {
  await draft.setAwaitingSent('S1', SENT);
  const [write] = stub.calls.saveFields;
  assert.equal(write.name, 'drafts');
  assert.equal(write.id, 'current');
  assert.deepEqual(write.fieldPaths, ['awaitingSent.S1']);
  assert.deepEqual(write.data, { awaitingSent: { S1: SENT } });
  assert.equal(stub.calls.saveDoc.length, 0, 'not the autosave, not a merge');
});

test('the firebase helper replaces each named path (mergeFields) and claims in a transaction', () => {
  const fs = read('js/orders/firebase-orders.js');
  const save = fs.slice(fs.indexOf('export async function saveFields'), fs.indexOf('export async function clearFieldsIf'));
  assert.match(save, /mergeFields: \['bakery', \.\.\.fieldPaths\]/);
  const claim = fs.slice(fs.indexOf('export async function clearFieldsIf'), fs.indexOf('// Create a document'));
  assert.match(claim, /runTransaction\(db/);
  assert.match(claim, /tx\.get\(ref\)/);
  assert.match(claim, /if \(!snap\.exists\(\) \|\| !decide\(snap\.data\(\)\)\) return false/);
  assert.match(claim, /tx\.update\(ref, update\)/);
});

test('«Sì» clears the chosen lines and, only when nothing is left, the day stamp', async () => {
  await draft.clearSentLines('S1', ['flour'], { clearDay: false });
  await draft.clearSentLines('S1', ['yeast'], { clearDay: true });
  assert.deepEqual(stub.calls.clearFields.map(c => c.paths), [['entries.flour'], ['entries.yeast', 'days.S1']]);
});

test('every device hears the question: the draft listener hands awaitingSent on', () => {
  const seen = [];
  draft.watchDraft(d => seen.push(d));
  stub.emit({ entries: {}, days: {}, awaitingSent: { S1: SENT } });
  assert.deepEqual(seen.at(-1).awaitingSent, { S1: SENT });
  stub.emit({ entries: {}, days: {} });
  assert.deepEqual(seen.at(-1).awaitingSent, {}, 'answered elsewhere: gone here too');
});

// ── the wiring (orders-main.js), pinned as text ──────────────────────────────────

const main = read('js/orders/orders-main.js');

test('both send roads wait for the answer instead of recording at once', () => {
  const screen = main.slice(main.indexOf('function openSendScreen'), main.indexOf('// ── «Invia» on a supplier'));
  assert.match(screen, /waitForAnswer\(rows\.map\(r => \(\{ supplierId: r\.id, quantities: r\.quantities, units: r\.units \}\)\)/);
  assert.ok(!/offerToRecordSent/.test(main), 'the old «mark as placed» prompt after a send is gone');
  const check = main.slice(main.indexOf('async function askSentCheck'), main.indexOf('// The line that says which suppliers'));
  assert.match(check, /supplierId: id, quantities: confirmed\.quantities\[id\], units: confirmed\.units\[id\]/,
    '«Invialo ora» stores the CONFIRMED numbers');
  assert.match(check, /return \{ ids: \[\], notReached \}/, 'and records nothing until somebody answers');
});

test('«Sì, inviato» still records at once (no question)', () => {
  const check = main.slice(main.indexOf('async function askSentCheck'), main.indexOf('// The line that says which suppliers'));
  assert.match(check, /if \(!outcome\.sendFirst\) return \{ ids, notReached: \[\] \};/);
});

test('«Sì» records through placeOrder: stored quantities, pinned day, no second question, only what went', () => {
  const fn = main.slice(main.indexOf('async function answerAwaitingSent'), main.indexOf('// ── Sending the list to whoever'));
  assert.match(fn, /confirm: false, alreadySent: true, sentOnly: true,/);
  assert.match(fn, /date: e\.date \|\| undefined, quantities: e\.quantities, units: e\.units,/);
  assert.match(fn, /claim: \(id, at\) => claimAwaitingSent\(id, at, claimDecision\)/);
  const place = main.slice(main.indexOf('async function placeOrder'), main.indexOf('// ── Clearing what has been typed'));
  assert.match(place, /if \(sentOnly\) await clearSentLines\(supplierId, sentLines, \{ clearDay \}\);/);
  assert.match(place, /linesToClear\(state\.entries/);
});

test('the device that sent it asks at once when the page comes back; Escape leaves it to the banner', () => {
  assert.match(main, /addEventListener\('visibilitychange', \(\) => \{\s*if \(document\.visibilityState !== 'visible' \|\| !askHere\.size\) return;/);
  const ask = main.slice(main.indexOf('async function maybeAskHere'), main.indexOf('// «Sì» / «No», from the banner'));
  assert.match(ask, /sentCheckDialog\(\{/);
  assert.match(ask, /cancelLabel: ''/);
  assert.match(ask, /if \(answer === 'yes'\) await answerAwaitingSent\(supplierId, 'yes'\);/);
  assert.match(ask, /else if \(answer === 'sendNow'\) await answerAwaitingSent\(supplierId, 'no'\);/);
});

test('a question the rules refuse stays on this device rather than vanishing', () => {
  const fn = main.slice(main.indexOf('function waitForAnswer'), main.indexOf('// The questions as the screen shows them'));
  assert.match(fn, /setAwaitingSent\(supplierId, entry\)\.catch\(/);
  assert.match(fn, /localAwaiting\.set\(supplierId, entry\)/);
});

test('the banner host is first on the order tab and is NOT moved into the tablet bell', () => {
  const html = read('orders.html');
  assert.ok(html.indexOf('id="orders-awaiting"') < html.indexOf('id="orders-owed"'));
  assert.ok(!/orders-awaiting/.test(read('js/orders/tablet-layout.js')));
  assert.match(main, /renderAwaiting\(document\.getElementById\('orders-awaiting'\)/);
});

test('the words, both languages', async () => {
  const d = (await import('../js/i18n.js'))._dictionaries();
  assert.equal(d.it['orders.awaiting.question'], 'Ordine a {supplier} inviato alle {time}: è partito?');
  assert.equal(d.en['orders.awaiting.question'], 'Order to {supplier} sent at {time}: did it go?');
  assert.equal(d.it['orders.awaiting.yes'], 'Sì');
  assert.equal(d.it['orders.awaiting.no'], 'No');
  for (const k of ['questionDay', 'kept', 'elsewhere', 'notShared']) {
    assert.ok(d.en[`orders.awaiting.${k}`] && d.it[`orders.awaiting.${k}`], k);
  }
});
