// «Chiudi come non ordinato» and «Ordine fatto» on the order summary sheet (Federico's tablet
// notes, 2 and 3 Nov 2026). The owner cannot read code: these pin what a CLOSED supplier means
// for every screen that counts «still to order today» — the Orders strip, the Home badge, the
// kiosk — and that the sheet offers the right button.
//
// drafts/current.skipped = { supplierId: 'YYYY-MM-DD' }: the day it was closed. Only that day.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  skippedOn, todayOrders, suppliersStillToOrder, closeOffer,
} from '../js/orders/reminders.js';
import { kioskSectionsFromData } from '../js/orders/kiosk-lines.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');

// 6 November 2026 is a Friday.
const FRIDAY = '2026-11-06';
const LAST_FRIDAY = '2026-10-30';
const ALBA = { id: 'alba', name: 'Alba', orderDays: ['Friday'], active: true };
const BRAVA = { id: 'brava', name: 'Brava', orderDays: ['Friday'], active: true };
const MONDAYS = { id: 'mon', name: 'Mondays', orderDays: ['Monday'], active: true };

test('skippedOn: only a close made TODAY counts — last week\'s never hides this week\'s order', () => {
  assert.deepEqual([...skippedOn({ alba: FRIDAY, brava: LAST_FRIDAY }, FRIDAY)], ['alba']);
  assert.equal(skippedOn(null, FRIDAY).size, 0);
  assert.equal(skippedOn(undefined, FRIDAY).size, 0);
  assert.equal(skippedOn({ alba: FRIDAY }, '').size, 0);
  assert.equal(skippedOn('alba', FRIDAY).size, 0, 'a stray non-map is ignored, never trusted');
});

test('todayOrders: a closed supplier is skipped, not placed — and a real order wins over the close', () => {
  const rows = todayOrders({
    suppliers: [BRAVA, ALBA, MONDAYS],
    history: [{ id: `${FRIDAY}_alba`, date: FRIDAY, supplierId: 'alba' }],
    today: FRIDAY,
    skipped: { alba: FRIDAY, brava: FRIDAY },
  });
  assert.deepEqual(rows.map(r => [r.supplier.id, r.placed, r.skipped]), [
    ['alba', true, false],   // ordered after being closed: the order is what happened
    ['brava', false, true],
  ]);
});

test('todayOrders without skipped behaves as before (every row says skipped: false)', () => {
  const rows = todayOrders({ suppliers: [ALBA], history: [], today: FRIDAY });
  assert.deepEqual(rows.map(r => [r.placed, r.skipped]), [[false, false]]);
});

test('the Home badge does not count a supplier closed as not ordered today', () => {
  const left = suppliersStillToOrder([ALBA, BRAVA], [], FRIDAY, { brava: FRIDAY });
  assert.deepEqual(left.map(s => s.id), ['alba']);
  // A close from another day changes nothing; no argument at all is the old behaviour.
  assert.deepEqual(suppliersStillToOrder([ALBA, BRAVA], [], FRIDAY, { brava: LAST_FRIDAY }).map(s => s.id), ['alba', 'brava']);
  assert.deepEqual(suppliersStillToOrder([ALBA, BRAVA], [], FRIDAY).map(s => s.id), ['alba', 'brava']);
});

test('the kiosk rest screen does not list a closed supplier as to order', () => {
  const sections = kioskSectionsFromData({
    suppliers: [ALBA, BRAVA], history: [], today: FRIDAY, weekStartsOn: 'Sunday', skipped: { brava: FRIDAY },
  });
  const toOrder = sections.find(s => s.titleKey === 'kiosk.rest.toOrderTitle');
  assert.deepEqual(toOrder.names, ['Alba']);
  const none = kioskSectionsFromData({
    suppliers: [BRAVA], history: [], today: FRIDAY, weekStartsOn: 'Sunday', skipped: { brava: FRIDAY },
  });
  assert.equal(none.find(s => s.titleKey === 'kiosk.rest.toOrderTitle'), undefined);
});

test('closeOffer: what the summary sheet offers about today', () => {
  assert.equal(closeOffer({ supplier: BRAVA, history: [], today: FRIDAY }), 'skip');
  assert.equal(closeOffer({ supplier: BRAVA, history: [], today: FRIDAY, skipped: { brava: FRIDAY } }), 'reopen');
  assert.equal(closeOffer({ supplier: BRAVA, history: [], today: FRIDAY, skipped: { brava: LAST_FRIDAY } }), 'skip');
  // Not its order day: there is nothing to close.
  assert.equal(closeOffer({ supplier: MONDAYS, history: [], today: FRIDAY }), '');
  // Already ordered today: nothing to close, nothing to reopen.
  assert.equal(closeOffer({
    supplier: BRAVA, history: [{ date: FRIDAY, supplierId: 'brava' }], today: FRIDAY, skipped: { brava: FRIDAY },
  }), '');
  assert.equal(closeOffer({ supplier: { ...BRAVA, active: false }, history: [], today: FRIDAY }), '');
  assert.equal(closeOffer({ supplier: null, history: [], today: FRIDAY }), '');
});

test('the close is written to the shared draft on its own, never through the autosave, and never moves updatedAt', () => {
  const src = read('js/orders/draft.js');
  const set = src.slice(src.indexOf('export function setSupplierSkipped'), src.indexOf('export function clearSupplierSkipped'));
  assert.match(set, /saveDoc\(COLLECTIONS\.drafts, DRAFT_ID, \{ skipped: \{ \[supplierId\]: day \} \}\)/);
  assert.doesNotMatch(set, /updatedAt|pending|scheduleDraftSave/);
  const clear = src.slice(src.indexOf('export function clearSupplierSkipped'));
  assert.match(clear, /clearFields\(COLLECTIONS\.drafts, DRAFT_ID, \[`skipped\.\$\{supplierId\}`\]\)/);
  // The snapshot hands it to the screen, and a repaint from the restored note keeps it.
  assert.match(src, /skipped = \{ \.\.\.\(doc\?\.skipped \|\| \{\}\) \};/);
});

test('the rules know the key, as an optional capped map', () => {
  const rules = read('firestore.rules');
  const block = rules.slice(rules.indexOf('match /drafts/{id}'), rules.indexOf('match /orders-history/{id}'));
  assert.match(block, /'bakery', 'entries', 'days', 'updatedAt', 'weekId', 'skipped'/);
  assert.match(block, /!\('skipped' in request\.resource\.data\)\s*\|\| \(request\.resource\.data\.skipped is map\s*&& request\.resource\.data\.skipped\.size\(\) <= 200\)/);
});

test('the Orders page wires the sheet, the snapshot and the keystroke', () => {
  const main = read('js/orders/orders-main.js');
  // The sheet gets all four, so no button is ever drawn dead.
  const build = main.slice(main.indexOf('const built = buildOrderSummaryView('));
  for (const name of ['closeOffer: () => closeOffer(', 'onPlaced: whenLive(() => placeFromSummary(', 'onSkip: whenLive(() => closeAsNotOrdered(', 'onReopen: whenLive(() => reopenToday(']) {
    assert.ok(build.slice(0, 900).includes(name), name);
  }
  // The snapshot carries the closes into the screen.
  assert.match(main, /state\.skipped = draft\.skipped \|\| \{\};/);
  // «Ordine fatto» closes the sheet BEFORE placeOrder: the confirmation must be the top screen.
  const place = main.slice(main.indexOf('function placeFromSummary'), main.indexOf('function backToListFrom'));
  assert.ok(place.indexOf('closeSummary()') > 0 && place.indexOf('closeSummary()') < place.indexOf('placeOrder('));
  // A quantity typed for a supplier closed today reopens it, on every keystroke path.
  assert.match(main, /if \(!stockOnly\) reopenIfTyped\(supplierId\);/);
  const reopen = main.slice(main.indexOf('function reopenIfTyped'));
  assert.match(reopen.slice(0, 600), /supplierHasItems\(supplierId, orderIngredients\(\), state\.entries\)/);
  assert.match(reopen.slice(0, 600), /clearSupplierSkipped\(supplierId\)/);
  // Local first: the close and the reopen are never awaited (a weak signal must not hang them).
  const close = main.slice(main.indexOf('async function closeAsNotOrdered'), main.indexOf('function reopenIfTyped'));
  assert.doesNotMatch(close, /await (setSupplierSkipped|clearSupplierSkipped)/);
  assert.match(close, /setSupplierSkipped\(supplierId, today\)\.catch\(/);
  assert.match(close, /clearSupplierSkipped\(supplierId\)\.catch\(/);
});

test('every reader of «still to order today» is handed the closes', () => {
  // The Home badge and the kiosk's own reads fetch the draft; Orders passes its live copy.
  assert.match(read('js/home-orders-badge.js'), /suppliersStillToOrder\(suppliers, todayHistory, today, skipped\)/);
  assert.match(read('js/kiosk-orders.js'), /kioskSectionsFromData\(\{ suppliers, history, today, weekStartsOn, skipped \}\)/);
  const main = read('js/orders/orders-main.js');
  assert.match(main, /todayOrders\(\{ suppliers: state\.suppliers, history: state\.history, today: todayISO\(\), skipped: state\.skipped \}\)/);
  const kiosk = main.slice(main.indexOf("window.addEventListener('kiosk-rest-info'"));
  assert.match(kiosk, /skipped: state\.skipped/);
});

// ── The sheet and the strip, drawn on a tiny fake document ──────────────────────────────
// Enough of the DOM for el() (js/orders/dom.js): the views build nothing else.
class FakeNode {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {};
    this._text = null; this.className = ''; this.dataset = {}; this.style = {}; this.innerHTML = '';
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text !== null ? this._text : this.children.map(c => c.textContent).join(''); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren(...n) { this.children = []; this._text = null; n.forEach(c => this.appendChild(c)); }
  get childElementCount() { return this.children.filter(c => c.tagName !== '#text').length; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  click() { (this.listeners.click || []).forEach(fn => fn({ target: this })); }
}
function all(node, pred, out = []) {
  if (pred(node)) out.push(node);
  node.children.forEach(c => all(c, pred, out));
  return out;
}
const byClass = (root, cls) => all(root, n => String(n.className).split(/\s+/).includes(cls));

async function views() {
  globalThis.document = {
    createElement: tag => new FakeNode(tag),
    createTextNode: text => Object.assign(new FakeNode('#text'), { _text: String(text) }),
  };
  const { buildOrderSummaryView } = await import('../js/orders/order-summary-view.js');
  const { renderTodayOrders } = await import('../js/orders/reminder-view.js');
  return { buildOrderSummaryView, renderTodayOrders };
}

const FLOUR = { id: 'flour', name: 'Flour', supplierId: 'brava' };

test('the sheet with nothing written and the order day today offers «Close as not ordered»', async () => {
  const { buildOrderSummaryView } = await views();
  let skipped = 0;
  const view = buildOrderSummaryView(BRAVA, [FLOUR], {}, {
    closeOffer: () => 'skip', onSkip: () => { skipped += 1; }, onPlaced: () => assert.fail('nothing to place'),
  });
  assert.equal(byClass(view.overlay, 'order-summary-place').length, 0, 'no «Order placed» with nothing written');
  const [skip] = byClass(view.overlay, 'order-summary-skip');
  assert.ok(skip, 'the close button is there');
  skip.click();
  assert.equal(skipped, 1);
});

test('the sheet with quantities offers «Order placed», which is the supplier screen\'s own action', async () => {
  const { buildOrderSummaryView } = await views();
  let placed = 0;
  const view = buildOrderSummaryView(BRAVA, [FLOUR], { flour: { qty: 3 } }, {
    closeOffer: () => 'skip', onPlaced: () => { placed += 1; },
  });
  const [place] = byClass(view.overlay, 'order-summary-place');
  assert.ok(place);
  place.click();
  assert.equal(placed, 1);
  assert.equal(byClass(view.overlay, 'order-summary-skip').length, 0, 'never «not ordered» over written quantities');
});

test('a closed supplier shows the state and «Reopen» — with or without quantities — and repaints live', async () => {
  const { buildOrderSummaryView } = await views();
  let offer = 'reopen';
  let reopened = 0;
  const view = buildOrderSummaryView(BRAVA, [FLOUR], {}, {
    closeOffer: () => offer, onReopen: () => { reopened += 1; }, onPlaced: () => {},
  });
  const [reopen] = byClass(view.overlay, 'order-summary-reopen');
  assert.ok(reopen);
  assert.equal(byClass(view.overlay, 'order-summary-closed')[0].getAttribute('role'), undefined, 'no live region rebuilt with its words inside');
  reopen.click();
  assert.equal(reopened, 1);
  // Typed after the close: both the state and «Order placed».
  view.repaint([FLOUR], { flour: { qty: 2 } });
  assert.equal(byClass(view.overlay, 'order-summary-reopen').length, 1);
  assert.equal(byClass(view.overlay, 'order-summary-place').length, 1);
  // Reopened on another phone: the next repaint offers the close again.
  offer = 'skip';
  view.repaint([FLOUR], {});
  assert.equal(byClass(view.overlay, 'order-summary-reopen').length, 0);
  assert.equal(byClass(view.overlay, 'order-summary-skip').length, 1);
  // Not due today, or already ordered: no buttons at all.
  offer = '';
  view.repaint([FLOUR], {});
  const [host] = byClass(view.overlay, 'order-summary-actions');
  assert.equal(host.hidden, true);
  assert.equal(byClass(host, 'order-summary-skip').length + byClass(host, 'order-summary-place').length, 0);
});

test('a colleague\'s keystroke repaints the lines but never replaces the buttons under a finger', async () => {
  const { buildOrderSummaryView } = await views();
  const view = buildOrderSummaryView(BRAVA, [FLOUR], { flour: { qty: 1 } }, { closeOffer: () => 'skip', onPlaced: () => {} });
  const [before] = byClass(view.overlay, 'order-summary-place');
  view.repaint([FLOUR], { flour: { qty: 2 } });
  view.repaint([FLOUR], { flour: { qty: 5 } });
  const [after] = byClass(view.overlay, 'order-summary-place');
  assert.equal(after, before, 'the same button element, so a tap or a focus on it survives');
  assert.match(view.overlay.textContent, /5/);
});

test('the «Order today» strip: a closed supplier is a dashed chip that opens its summary; all handled = all done', async () => {
  const { renderTodayOrders } = await views();
  const host = new FakeNode('div');
  const opened = [];
  renderTodayOrders(host, [
    { supplier: ALBA, placed: false, skipped: false },
    { supplier: BRAVA, placed: false, skipped: true },
  ], { onPick: () => assert.fail('a closed chip opens the summary, not the order'), onOpenSkipped: id => opened.push(id) });
  const [chip] = byClass(host, 'skipped');
  assert.ok(chip, 'the closed chip is drawn');
  assert.equal(chip.tagName, 'button');
  assert.match(chip.textContent, /Brava/);
  chip.click();
  assert.deepEqual(opened, ['brava']);

  renderTodayOrders(host, [
    { supplier: ALBA, placed: true, skipped: false },
    { supplier: BRAVA, placed: false, skipped: true },
  ], {});
  assert.equal(byClass(host, 'all-done').length, 1, 'ordered + closed = nothing left to do today');
  // …but not «all placed»: the chips stay, so the closed one still leads to «Riapri».
  assert.equal(byClass(host, 'skipped').length, 1);
  assert.doesNotMatch(host.textContent, /tutti fatti|all placed/i);

  renderTodayOrders(host, [{ supplier: ALBA, placed: true, skipped: false }], {});
  assert.equal(byClass(host, 'today-chip').length, 0, 'all really placed: the one-line banner');
});
