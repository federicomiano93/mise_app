// Nothing added to the shared order stays unknown to the person who buys it.
//
// ⚠️⚠️ THE SCENARIO, IN FEDERICO'S OWN WORDS (24 Aug 2026): «il dipendente manda
// l'ordine al capo, il capo lo vede e fa gli ordini, magari dopo il dipendente ha
// dimenticato qualcosa e modifica l'ordine ma il capo l'ha già fatto e magari non lo
// vede». Reading the code, the danger is real but not in the shape it first looks:
// a SENT LIST CANNOT BE EDITED — the rules allow only the ticks — so what the
// employee changes is the SHARED ORDER, which is live on every phone and which both
// the list and the recorded order are only photographs of.
//
// What already existed covered half of it: liveDifference() marks a quantity that
// moved, but it walks only the rows ALREADY IN the frozen list and skips every row
// already ticked. So an ingredient ADDED afterwards was invisible, and a row the
// manager had already ordered was never looked at again — which is exactly the case
// Federico described.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { untoldChanges, orderedToday } from '../js/orders/untold-changes.js';
import { _dictionaries } from '../js/i18n.js';

const TODAY = '2026-08-24';
const SUPPLIERS = [{ id: 's1', name: 'Brava Fresh' }];
const ING = [
  { id: 'flour', name: 'Flour', supplierId: 's1' },
  { id: 'bacon', name: 'Bacon', supplierId: 's1' },
  { id: 'olives', name: 'Olives', supplierId: 's2' },
];

const list = (quantities, over = {}) => ({
  date: TODAY,
  quantities,
  supplierOf: Object.fromEntries(Object.keys(quantities).map(k => [k, 's1'])),
  fromName: 'Marco',
  ...over,
});
const record = (quantities, over = {}) => ({
  id: `${TODAY}_s1`, date: TODAY, supplierId: 's1', quantities, ...over,
});
const entries = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { qty: v }]));

const run = ({ requests = [], history = [], draft = {} }) => untoldChanges({
  suppliers: SUPPLIERS, ingredients: ING, entries: entries(draft),
  requests, history, today: TODAY,
});

// ── 1. The case that was invisible ───────────────────────────────────────────

// ⚠️⚠️ THE WHOLE POINT. Bacon was not on the list at all, so liveDifference — which
// walks the list's own rows — could never have mentioned it.
test('⚠️⚠️ an ingredient ADDED after the list was sent is reported', () => {
  const out = run({ requests: [list({ flour: 4 })], draft: { flour: 4, bacon: 3 } });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].rows.map(r => r.id), ['bacon']);
  assert.equal(out[0].rows[0].extra, 3);
});

test('a quantity RAISED after the list was sent is reported, with the difference', () => {
  const out = run({ requests: [list({ flour: 4 })], draft: { flour: 6 } });
  assert.equal(out[0].rows[0].extra, 2, 'two more than anybody was told about');
});

// ⚠️ The app must not comment on work nobody has to redo.
test('a quantity LOWERED, or unchanged, says nothing', () => {
  assert.deepEqual(run({ requests: [list({ flour: 4 })], draft: { flour: 2 } }), []);
  assert.deepEqual(run({ requests: [list({ flour: 4 })], draft: { flour: 4 } }), []);
});

// ── 2. The case the app cannot put right ─────────────────────────────────────

// ⚠️⚠️ ALREADY ORDERED IS ITS OWN ANSWER. Everything else is an addition somebody
// still has time to act on; this one has been said down a telephone already.
test('⚠️⚠️ a row raised AFTER it was ordered is separated from the rest', () => {
  const out = run({
    requests: [list({ flour: 4 })],
    history: [record({ flour: 4 })],
    draft: { flour: 6, bacon: 2 },
  });
  assert.deepEqual(out[0].afterOrdering.map(r => r.id), ['flour']);
  assert.deepEqual(out[0].added.map(r => r.id), ['bacon']);
  assert.equal(out[0].afterOrdering[0].ordered, 4, 'it says how much had gone out');
  assert.equal(out[0].afterOrdering[0].live, 6, 'and how much is being asked for now');
});

test('every row of one supplier is either an addition or an after-ordering row', () => {
  const out = run({
    requests: [list({ flour: 4 })],
    history: [record({ flour: 4 })],
    draft: { flour: 6, bacon: 2 },
  });
  assert.equal(out[0].added.length + out[0].afterOrdering.length, out[0].rows.length);
});

// ── 3. Why it stays quiet ────────────────────────────────────────────────────

// ⚠️⚠️ THE GATE. Before anybody has been told anything, an order being typed is
// simply an order being typed — reporting it would be an alarm that is always on.
test('⚠️⚠️ nothing sent and nothing ordered today: silence, however full the order', () => {
  assert.deepEqual(run({ draft: { flour: 99, bacon: 99 } }), []);
});

test('yesterday’s list does not open the question for today', () => {
  assert.deepEqual(
    run({ requests: [list({ flour: 4 }, { date: '2026-08-23' })], draft: { flour: 9 } }), []);
});

// ⚠️ Recording an order CLEARS that supplier's rows, so the live order drops to 0 and
// the answer is silence. An alarm that fires when everything went right is an alarm
// people learn to ignore — the same reason liveDifference skips ticked rows.
test('⚠️ after the order is recorded and the rows cleared, it goes quiet by itself', () => {
  assert.deepEqual(run({
    requests: [list({ flour: 4 })], history: [record({ flour: 4 })], draft: {},
  }), []);
});

test('⚠️ sending the list again also silences it — `told` catches up with the order', () => {
  const before = run({ requests: [list({ flour: 4 })], draft: { flour: 6 } });
  assert.equal(before.length, 1);
  const after = run({
    requests: [list({ flour: 4 }), list({ flour: 6 })], draft: { flour: 6 },
  });
  assert.deepEqual(after, []);
});

// ── 4. Boundaries ────────────────────────────────────────────────────────────

test('another supplier’s ingredients are never counted against this one', () => {
  const out = run({ requests: [list({ flour: 4 })], draft: { flour: 4, olives: 50 } });
  assert.deepEqual(out, [], 'olives belong to s2 and s2 has been told nothing');
});

test('the larger of "asked" and "ordered" is the baseline, not their sum', () => {
  const out = run({
    requests: [list({ flour: 4 })], history: [record({ flour: 6 })], draft: { flour: 6 },
  });
  assert.deepEqual(out, [], 'ordered 6 covers a list that asked for 4');
});

test('the row carries the supplier’s name and the ingredient’s, for the screen', () => {
  const out = run({ requests: [list({ flour: 4 })], draft: { flour: 4, bacon: 1 } });
  assert.equal(out[0].supplierName, 'Brava Fresh');
  assert.equal(out[0].rows[0].name, 'Bacon');
});

test('junk in, no throw out', () => {
  assert.deepEqual(untoldChanges(), []);
  assert.deepEqual(untoldChanges({}), []);
  assert.deepEqual(untoldChanges({ suppliers: [null, {}], ingredients: null }), []);
});

// ── 5. orderedToday ──────────────────────────────────────────────────────────

test('orderedToday reads the day’s record for that supplier only', () => {
  const history = [record({ flour: 4 }), { id: `${TODAY}_s2`, quantities: { olives: 9 } }];
  assert.deepEqual(orderedToday(history, 's1', TODAY), { flour: 4 });
  assert.deepEqual(orderedToday(history, 's9', TODAY), {});
  assert.deepEqual(orderedToday(null, 's1', TODAY), {});
});

// ── 6. The wiring nothing on screen can show ─────────────────────────────────

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
// ⚠️ THE CODE, NOT THE FILE. This project explains itself in its comments, and they
// name the very things these guards forbid.
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MAIN = codeOf(read('js/orders/orders-main.js'));
const VIEW = codeOf(read('js/orders/untold-view.js'));
const REQ = codeOf(read('js/orders/order-requests.js'));

// ⚠️⚠️ TWO CALL SITES, AND BOTH ARE NEEDED. The draft answers one half (typing more),
// the ORDER LISTS answer the other (sending it again). With only the first, somebody
// who had just re-sent the list would be told for the rest of the day that they had
// added something — an alarm that outlives its reason is one people switch off.
test('⚠️⚠️ the banner is repainted when the draft changes AND when a list arrives', () => {
  const reminders = MAIN.slice(MAIN.indexOf('function renderReminders()'));
  // The function body ends at the first closing brace in column 1.
  const body = reminders.slice(0, reminders.search(/^\}/m));
  assert.ok(body.length > 100, 'the slice must not be empty');
  assert.ok(body.includes('renderUntoldChanges()'),
    'the draft/history/supplier path must repaint it');

  const watcher = MAIN.slice(MAIN.indexOf('watchOrderRequests('));
  assert.ok(watcher.length > 100, 'the slice must not be empty');
  assert.ok(watcher.slice(0, watcher.indexOf('liveDataLost')).includes('renderUntoldChanges()'),
    'sending the list again must be able to silence it');
});

// ⚠️ IT IS DERIVED, SO THERE IS NOTHING TO DISMISS. A dismissal would be a stored
// fact that can be left switched on by a failed write — and switched off while the
// thing it was about is still true.
test('⚠️ the banner offers no way to dismiss it', () => {
  assert.ok(!/dismiss|close|hide-?me|✕|×/i.test(VIEW),
    'nothing here may look like a way to make it go away without acting');
});

// ⚠️ A BUTTON THAT CANNOT WORK IS WORSE THAN NO BUTTON.
test('⚠️ "send the list again" is offered only when that road is open', () => {
  assert.match(MAIN, /canResend: routesFor\(/);
  assert.ok(VIEW.includes('!canManage && canResend'),
    'not to whoever runs the place — they are who it would be sent TO');
});

// ⚠️⚠️ THE ONE THE APP CANNOT PUT RIGHT MUST NOT BE MIXED WITH THE REST.
test('⚠️⚠️ what was already ordered is drawn as its own block', () => {
  assert.ok(VIEW.includes('group.afterOrdering'), 'it reads the separated list');
  assert.ok(VIEW.includes('untold-ordered'), 'and gives it its own block');
  const css = read('orders.css');
  assert.match(css, /\.untold-ordered\s*\{[^}]*--error-bg/,
    'in the colour reserved for what cannot be undone');
});

test('the sent list is told what was actually ordered', () => {
  assert.match(MAIN, /orderedById: orderedForRequest\(/);
  assert.ok(REQ.includes('orderedQty !== undefined && orderedQty !== item.qty'),
    'and says so only when the two disagree');
});

// ⚠️⚠️ RECORDING AN ORDER CLEARS THE ROWS, so on a row already bought the old
// "now in the list" mark always reads 0 — literally true, and read as an alarm about
// the leftovers of a job already done, right beside the line saying how much was
// actually bought. Found by looking at the row on a real screen, after every
// measurement had passed.
test('⚠️⚠️ a row that has been ordered is not also asked whether the order moved', () => {
  const fn = REQ.slice(REQ.indexOf('const differences = '));
  const decl = fn.slice(0, fn.indexOf(';'));
  assert.ok(decl.length > 40, 'the slice must not be empty');
  assert.ok(decl.includes('orderedById[id] === undefined'),
    'the two lines would otherwise contradict each other on the same row');
});

test('the new modules are precached, or an offline phone 404s on them', () => {
  const sw = read('sw.js');
  ['js/orders/untold-changes.js', 'js/orders/untold-view.js']
    .forEach(f => assert.ok(sw.includes(`'./${f}'`), f + ' is missing from ASSETS'));
});

test('the banner has somewhere to be drawn', () => {
  assert.match(read('orders.html'), /id="orders-untold"/);
});

test('every new phrase exists in BOTH languages', () => {
  const keys = [
    'orders.untold.changed', 'orders.untold.resend', 'orders.untold.alreadyTitle',
    'orders.untold.alreadyLine', 'orders.untold.callSupplier', 'orders.untold.ordered',
  ];
  const dicts = Object.entries(_dictionaries());
  assert.ok(dicts.length >= 2);
  for (const [lang, dict] of dicts) {
    for (const key of keys) {
      const value = dict[key];
      const ok = typeof value === 'string' ? value.trim() : (value && value.other);
      assert.ok(ok, `${key} is missing in ${lang}`);
    }
  }
});
