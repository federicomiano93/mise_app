// What gets recorded is what the person placing the order CONFIRMED.
//
// ⚠️⚠️ THE DEFECT THESE GUARD, and it is not visible by using the app. The shared
// order is live on every phone in the building; "Order placed" used to archive
// whatever it said at the instant of the tap, not what the person tapping had
// read. order-request-model.js says so about itself: "a manager reading 4 on this
// screen and tapping Order placed can record 6, with nothing saying so".
//
// Federico's rule, 24 Aug 2026: what counts is what whoever places the order
// confirms — the manager's confirmation when an employee sends them a list, the
// employee's own when they ring the supplier themselves. ONE rule, which is why
// there is no setting for it anywhere and no test here looks for one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { askedToday, confirmedEntries } from '../js/orders/untold-changes.js';
import { buildSupplierArchive } from '../js/orders/archive.js';
import { _dictionaries } from '../js/i18n.js';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
// ⚠️ THE CODE, NOT THE FILE. Comments are where this project explains itself, and
// they name the very things these guards forbid — a guard that reads its own
// explanation passes while enforcing nothing.
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MAIN = codeOf(read('js/orders/orders-main.js'));
const SCREEN = codeOf(read('js/orders/place-confirm.js'));

const ING = [
  { id: 'flour', name: 'Flour', supplierId: 's1' },
  { id: 'bacon', name: 'Bacon', supplierId: 's1' },
  { id: 'milk', name: 'Milk', supplierId: 's1' },
];
const SUPPLIER = { id: 's1', name: 'Brakes' };

// ── 1. confirmedEntries — the rule itself ────────────────────────────────────

test('the confirmed number is what comes back, not the live one', () => {
  const live = { flour: { qty: 6, stock: 2 } };
  const out = confirmedEntries(live, ING, { flour: 4 });
  assert.equal(out.flour.qty, 4);
});

// ⚠️⚠️ THE ONE THAT MATTERS MOST. A row the confirmer zeroed is simply ABSENT from
// what comes back from the screen. Leaving it alone would record the live quantity
// they had just refused — the exact opposite of what they said, and silently.
test('⚠️⚠️ a row set to 0 is recorded as 0, never left at the live quantity', () => {
  const live = { flour: { qty: 6 }, bacon: { qty: 3 } };
  const out = confirmedEntries(live, ING, { flour: 4 });   // bacon was zeroed
  assert.equal(out.bacon.qty, 0, 'a refused row must not survive on the live value');

  const record = buildSupplierArchive({
    supplier: SUPPLIER, ingredients: ING, entries: out, date: '2026-08-24',
  });
  assert.deepEqual(record.quantities, { flour: 4 }, 'and it must not reach History');
});

test('⚠️ the caller’s entries are never mutated — a draft save holds them by reference', () => {
  const live = { flour: { qty: 6, stock: 2 } };
  const before = JSON.stringify(live);
  confirmedEntries(live, ING, { flour: 4 });
  assert.equal(JSON.stringify(live), before,
    'confirming an order must not rewrite the shared order everybody else is typing into');
});

test('⚠️ another supplier’s rows are untouched — one order, one supplier', () => {
  const live = { flour: { qty: 6 }, olives: { qty: 9 } };
  const out = confirmedEntries(live, ING, { flour: 4 });
  assert.equal(out.olives.qty, 9);
});

test('the stock reading survives — counting the shelves is not what was confirmed', () => {
  const out = confirmedEntries({ flour: { qty: 6, stock: 3 } }, ING, { flour: 4 });
  assert.equal(out.flour.stock, 3);
});

test('junk quantities become 0, never NaN — Firestore refuses a non-finite number', () => {
  const live = { flour: { qty: 6 }, bacon: { qty: 6 }, milk: { qty: 6 } };
  const out = confirmedEntries(live, ING, { flour: -4, bacon: 'x', milk: Infinity });
  assert.deepEqual(
    [out.flour.qty, out.bacon.qty, out.milk.qty], [0, 0, 0]);
});

test('no entries, no ingredients, no quantities — nothing throws', () => {
  assert.deepEqual(confirmedEntries(null, null, null), {});
  assert.deepEqual(confirmedEntries(undefined, ING, undefined),
    { flour: { qty: 0 }, bacon: { qty: 0 }, milk: { qty: 0 } });
});

// ── 2. askedToday — what the confirmer is shown they were asked for ──────────

const request = (over) => ({
  date: '2026-08-24',
  quantities: { flour: 4 },
  supplierOf: { flour: 's1' },
  ...over,
});

test('what today’s lists asked for, per supplier', () => {
  assert.deepEqual(askedToday([request()], 's1', '2026-08-24'), { flour: 4 });
});

// ⚠️ A sent list is frozen — the rules allow only the ticks — so a SECOND list is
// how somebody adds a forgotten item, and both are still on the manager's screen.
// Reading only the newest would answer "asked for 2" when an earlier list had
// already asked for 6.
test('⚠️ two lists the same day: the HIGHEST wins, not the latest', () => {
  const lists = [
    request({ quantities: { flour: 6 }, createdAt: 'a' }),
    request({ quantities: { flour: 2 }, createdAt: 'b' }),
  ];
  assert.deepEqual(askedToday(lists, 's1', '2026-08-24'), { flour: 6 });
});

test('another supplier’s lines are not counted', () => {
  const list = request({
    quantities: { flour: 4, olives: 9 },
    supplierOf: { flour: 's1', olives: 's2' },
  });
  assert.deepEqual(askedToday([list], 's1', '2026-08-24'), { flour: 4 });
});

test('yesterday’s list is not today’s question', () => {
  assert.deepEqual(askedToday([request({ date: '2026-08-23' })], 's1', '2026-08-24'), {});
});

// ⚠️ THE SCREEN READS `undefined` AS "NOBODY ASKED" AND DRAWS NOTHING. A 0 here
// would read as "they asked for none of it", which is a different statement and a
// false one.
test('⚠️ a row no list carried is ABSENT, not 0', () => {
  const out = askedToday([request()], 's1', '2026-08-24');
  assert.equal(out.bacon, undefined);
});

test('junk lists are ignored rather than throwing', () => {
  assert.deepEqual(askedToday(null, 's1', '2026-08-24'), {});
  assert.deepEqual(askedToday([null, {}, { date: '2026-08-24' }], 's1', '2026-08-24'), {});
});

// ── 3. The wiring nothing on screen can show ─────────────────────────────────

// ⚠️⚠️ THE SINGLE LINE THE WHOLE RULE RESTS ON. Hand archiveSupplier state.entries
// again and every test above still passes while the app is back to recording what
// the shared order happened to say.
test('⚠️⚠️ archiveSupplier is handed the CONFIRMED entries, never state.entries', () => {
  const call = MAIN.slice(MAIN.indexOf('await archiveSupplier({'));
  assert.ok(call.length > 40, 'the slice must not be empty — the call has to exist');
  const args = call.slice(0, call.indexOf('});'));
  assert.match(args, /entries: entriesToRecord\(/);
  assert.ok(!/entries: state\.entries/.test(args),
    'the live shared order must never be what is recorded');
});

test('entriesToRecord asks the pure rule — the logic is not re-implemented here', () => {
  const fn = MAIN.slice(MAIN.indexOf('function entriesToRecord('));
  assert.ok(fn.includes('confirmedEntries('), 'one definition of the rule, in one place');
});

// ⚠️ An order takes a second to write, and this screen is open for much longer
// than the dialog it replaced. Without the re-check a second tap during the
// confirmation passes every guard and mergeArchives DOUBLES the order.
test('⚠️ the in-flight guard is re-checked AFTER the confirmation screen closes', () => {
  const body = MAIN.slice(MAIN.indexOf('async function placeOrder('));
  const asked = body.indexOf('askToConfirmPlacement(');
  const recheck = body.indexOf('placing.has(supplierId)', asked);
  assert.ok(asked > 0, 'placeOrder must ask for a confirmation');
  assert.ok(recheck > asked, 'and must ask again whether an order is already going out');
});

// ⚠️ Two roads to recording an order are two places this rule can drift apart.
test('⚠️ recording several suppliers goes through the SAME screen', () => {
  const fn = MAIN.slice(MAIN.indexOf('async function recordSuppliers('));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.ok(body.length > 200, 'the slice must not be empty');
  assert.ok(body.includes('openPlaceConfirm('), 'the multi-supplier path asks too');
  assert.ok(!body.includes('confirmDialog('),
    'a dialog here would be a second road, showing numbers nobody can correct');
});

// ⚠️ .preview-overlay is in BUSY_SELECTORS (js/update-gate.js), so a compulsory
// app update cannot reload the page out from under corrections typed but not yet
// recorded. Renaming the class would take that away in silence.
test('⚠️ the screen is a .preview-overlay, so an update cannot reload it away', () => {
  assert.match(SCREEN, /class: 'preview-overlay/);
  const busy = read('js/update-gate.js');
  assert.ok(busy.includes("'.preview-overlay'"), 'and that class is still a busy marker');
});

// ⚠️ The extra-digit nudge survived the dialog this screen replaced: "usually about
// 4" beside a 40 states a fact, while this says what to do about it.
test('⚠️ the extra-digit warning is still shown, and only while a row is odd', () => {
  assert.match(SCREEN, /orders\.checkExtraDigit/);
  assert.match(SCREEN, /digitWarning\.hidden = /);
});

test('every new phrase exists in BOTH languages', () => {
  const keys = [
    'orders.confirm.aboutToRecord', 'orders.confirm.asked', 'orders.confirm.usually',
    'orders.confirm.addsToExisting', 'orders.confirm.sendFirst', 'orders.confirm.allZero',
    'orders.confirm.noneRecorded', 'orders.confirm.addTitle',
  ];
  const dicts = Object.entries(_dictionaries());
  assert.ok(dicts.length >= 2, 'there are at least two languages to check');
  for (const [lang, dict] of dicts) {
    for (const key of keys) {
      assert.ok(typeof dict[key] === 'string' && dict[key].trim(),
        `${key} is missing in ${lang}`);
    }
  }
});

// The six sentences the screen replaced were prose describing numbers nobody could
// see. A key left behind in the dictionary is the next translator's trap.
test('the dialog’s own sentences are gone from both dictionaries', () => {
  const dead = [
    'orders.alreadyRecordedFor', 'orders.recordOrderFor', 'orders.markPlacedFor',
    'orders.alreadyRecordedThatDay', 'orders.thisQuantityIsMuch',
    'orders.theseQuantitiesAreMuch',
    // ⚠ THE TWO TITLES THAT NAMED THE SUPPLIER. Measured at 320px, "Add to Brava
    // Fresh's order" wrapped to THREE lines in the header — and the body already
    // names the supplier on its first line, with the day beside it.
    'orders.orderPlacedTitle', 'orders.addToOrderOf',
    // The dialog's "Not yet" cancel label. The screen's way out is the Back arrow
    // every other full-screen overlay in this app uses.
    'orders.notYet',
  ];
  for (const [lang, dict] of Object.entries(_dictionaries())) {
    for (const key of dead) {
      assert.equal(dict[key], undefined, `${key} still in ${lang}`);
    }
  }
});
