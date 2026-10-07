// «Did you send the order?» — asked after the review screen is confirmed and before anything
// is archived. Pure rules + source pins on the wiring (orders-main.js is not importable in node).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  shouldAskSent, sentCheckPhrases, outcomeOf, suppliersToRecord, confirmedRows,
} from '../js/orders/sent-check.js';
import { sentCheckDialog } from '../js/orders/sent-check-dialog.js';
import { sendOffers } from '../js/orders/send-chooser.js';
import { orderedItems, buildOrderMessage } from '../js/orders/order-text.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');

test('the question is asked for a normal recording and for the post-send prompt', () => {
  assert.equal(shouldAskSent({ confirm: true }), true);
  assert.equal(shouldAskSent({}), true);
});

test('the «placed yesterday» banner and the already-asked batch path skip it', () => {
  assert.equal(shouldAskSent({ confirm: true, alreadySent: true }), false);
  assert.equal(shouldAskSent({ confirm: false }), false);
  const src = read('js/orders/orders-main.js');
  assert.match(src, /placeOrder\(supplierId, \{ date: day, alreadySent: true \}\)/);
  assert.match(src, /if \(shouldAskSent\(\{ confirm, alreadySent \}\)\)/);
});

test('one supplier or several picks the matching words', () => {
  assert.deepEqual(sentCheckPhrases(1, 'Brava'), {
    titleKey: 'orders.sentCheck.one', titleVars: { name: 'Brava' },
    yesKey: 'orders.sentCheck.yes', sendNowKey: 'orders.sentCheck.sendNow',
  });
  assert.deepEqual(sentCheckPhrases(2, 'A and B'), {
    titleKey: 'orders.sentCheck.many', titleVars: { names: 'A and B' },
    yesKey: 'orders.sentCheck.yesMany', sendNowKey: 'orders.sentCheck.sendNowMany',
  });
});

test('three outcomes: yes records, send-now sends first, anything else records nothing', () => {
  assert.deepEqual(outcomeOf('yes'), { record: true, sendFirst: false });
  assert.deepEqual(outcomeOf('sendNow'), { record: true, sendFirst: true });
  for (const cancelled of [null, undefined, false, 'cancel']) {
    assert.deepEqual(outcomeOf(cancelled), { record: false, sendFirst: false });
  }
});

test('after a send only the suppliers the road reached are recorded; a backed-out chooser records none', () => {
  assert.deepEqual(suppliersToRecord(['a', 'b', 'c'], ['c', 'a']), ['a', 'c']);
  assert.deepEqual(suppliersToRecord(['a', 'b'], []), []);
  assert.deepEqual(suppliersToRecord(['a'], undefined), []);
});

test('wiring: both recording paths ask, before archiving, and the send carries the CONFIRMED numbers', () => {
  const src = read('js/orders/orders-main.js');
  // recordSuppliers: asked after the review, before the archive loop.
  const rec = src.slice(src.indexOf('async function recordSuppliers'), src.indexOf('// ── Order placed for several suppliers at once'));
  assert.ok(rec.indexOf('askSentCheck(') > rec.indexOf('if (!confirmed) return;'));
  assert.ok(rec.indexOf('askSentCheck(') < rec.indexOf('await placeOrder('));
  assert.match(rec, /if \(!recordable\.has\(supplier\.id\)\) continue;/);
  // placeOrder: asked right after the review screen, before the archive.
  const place = src.slice(src.indexOf('async function placeOrder'), src.indexOf('await archiveSupplier'));
  assert.ok(place.indexOf('askSentCheck(') > place.indexOf('askToConfirmPlacement('));
  // The message rows are built from the confirmed numbers, not the live draft.
  const ask = src.slice(src.indexOf('async function askSentCheck'), src.indexOf('// ── Order placed for several suppliers at once'));
  assert.match(ask, /confirmedRows\(/);
  assert.doesNotMatch(ask, /itemsFromQuantities|state\.entries/);
  assert.match(ask, /chooseAndSend\(/);
  // Only supplier roads, with the send screen's own unit-clash check; no manager road.
  assert.match(ask, /supplierRoadsOnly: true/);
  assert.match(ask, /beforeSend: sendRows => refuseOnUnitConflict\(/);
  assert.doesNotMatch(ask, /sendListToManagers|onSendToManager/);
  // Backing out of the chooser records nothing; what was not reached is said.
  assert.match(ask, /suppliersToRecord\(ids, sent\)/);
  assert.match(ask, /sentCheck\.notReached/);
});

// ⚠️ «Send it now» must write the SAME message the normal send screen writes for the same
// numbers. The confirmed units are the unit every row showed (the card's own included); the
// send screen drops it again wherever the card offers no choice.
const cards = {
  s1: [
    { id: 'flour', name: 'Flour', weight: '', unit: 'kg' },                         // unit, no packUnit
    { id: 'oil', name: 'Oil', weight: '5 L', unit: 'KG' },                          // invoice-style unit
    { id: 'tom', name: 'Tomatoes', weight: '', unit: 'cartone', packUnit: 'busta' }, // a real choice
    { id: 'sugar', name: 'Sugar', weight: '', unit: 'kg', packUnit: 'busta' },
  ],
};
const draft = {                      // what the draft holds: no unit unless a non-default one was chosen
  flour: { qty: 3 }, oil: { qty: 2 }, tom: { qty: 4 }, sugar: { qty: 5, unit: 'busta' },
};
const confirmed = {                  // what the review screen froze: every row's unit, defaults included
  quantities: { s1: { flour: 3, oil: 2, tom: 4, sugar: 5 } },
  units: { s1: { flour: 'kg', oil: 'KG', tom: 'cartone', sugar: 'busta' } },
};

test('«Send it now» writes byte-for-byte the message of the normal send screen', () => {
  const normal = orderedItems(cards.s1, draft);
  const now = confirmedRows([{ id: 's1', name: 'Brava' }], cards, confirmed)[0].items;
  const text = items => buildOrderMessage([{ supplierName: 'Brava', items }], { locationName: 'Venue' });
  assert.equal(text(now), text(normal));
  // And the lines really are the expected ones: a unit only where there is a choice.
  assert.match(text(now), /- Flour: 3\n/);
  assert.match(text(now), /- Oil: 2\n/);
  assert.match(text(now), /- Tomatoes: 4 × cartone$/);
  assert.match(text(now), /- Sugar: 5 × busta\n/);
});

test('«Send it now» carries the CORRECTED number, not the draft one', () => {
  const corrected = { ...confirmed, quantities: { s1: { flour: 9, oil: 2, tom: 4, sugar: 5 } } };
  const items = confirmedRows([{ id: 's1', name: 'Brava' }], cards, corrected)[0].items;
  assert.equal(items.find(i => i.name === 'Flour').qty, 9);
  assert.deepEqual(confirmedRows([{ id: 's1', name: 'Brava' }], cards, { quantities: { s1: {} }, units: {} }), []);
});

test('«Send it now» is offered only when a road to a SUPPLIER is open for this person', () => {
  const both = { name: 'A', phone: '1', email: 'a@x.test' };
  const managerOnly = { routes: { whatsapp: false, whatsappSupplier: false, email: false, manager: true } };
  const all = { routes: { whatsapp: true, whatsappSupplier: true, email: true, manager: true } };
  // An employee whose only open road is the in-app list: nothing to offer.
  assert.deepEqual(sendOffers({ settings: managerOnly, canManage: false, suppliers: [both], supplierRoadsOnly: true }), []);
  // The manager road is never one of the offered roads for «Send it now».
  const roads = sendOffers({ settings: all, canManage: false, suppliers: [both], supplierRoadsOnly: true }).map(o => o.route);
  assert.ok(roads.length > 0);
  assert.ok(!roads.includes('manager'));
  // A per-supplier road with nobody reachable is not usable either.
  const nobody = { name: 'B' };
  const onlyDirect = { routes: { whatsapp: false, whatsappSupplier: true, email: false, manager: false } };
  assert.deepEqual(sendOffers({ settings: onlyDirect, canManage: false, suppliers: [nobody], supplierRoadsOnly: true }), []);
  const src = read('js/orders/orders-main.js');
  assert.match(src, /sendNowLabel: canSendNow \? t\(phrases\.sendNowKey\) : ''/);
});

test('a per-supplier road records only a window that really opened (a blocked pop-up does not)', () => {
  const src = read('js/orders/send-chooser.js');
  assert.match(src, /const opened = window\.open\(url, '_blank'\);\s*if \(!opened && offer\.route !== 'email'\) return;/);
  assert.doesNotMatch(src, /window\.open\([^)]*noopener/);
});

// A fake DOM, just enough for the dialog: elements with listeners, focus and removal.
function fakeDom() {
  const listeners = { document: [] };
  const focused = { el: null };
  const make = tag => {
    const el = {
      tag, className: '', textContent: '', children: [], attrs: {}, handlers: {}, parent: null, removed: false,
      setAttribute(k, v) { this.attrs[k] = v; },
      append(...kids) { kids.forEach(k => { k.parent = this; this.children.push(k); }); },
      appendChild(k) { this.append(k); return k; },
      addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); },
      focus() { focused.el = this; },
      remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); },
      fire(type, extra = {}) { (this.handlers[type] || []).forEach(fn => fn({ target: this, ...extra })); },
    };
    return el;
  };
  const body = make('body');
  const outside = make('button');           // what had the focus before the dialog opened
  focused.el = outside;
  globalThis.document = {
    createElement: make,
    body,
    get activeElement() { return focused.el; },
    addEventListener(type, fn) { listeners.document.push({ type, fn }); },
    removeEventListener(type, fn) { listeners.document = listeners.document.filter(l => !(l.type === type && l.fn === fn)); },
  };
  const press = key => {
    const event = { key, shiftKey: false, prevented: false, preventDefault() { this.prevented = true; } };
    listeners.document.filter(l => l.type === 'keydown').forEach(l => l.fn(event));
    return event;
  };
  const buttons = () => {
    const found = [];
    const walk = n => { if (n.tag === 'button') found.push(n); n.children.forEach(walk); };
    walk(body);
    return found;
  };
  return { body, outside, focused, press, buttons, listeners };
}

test('the three-answer dialog: Yes, Send now, Escape and backdrop answer as told, and focus comes back', async () => {
  const dom = fakeDom();
  const labels = { title: 'Did you send?', yesLabel: 'Yes', sendNowLabel: 'Now', cancelLabel: 'Cancel' };
  try {
    // Yes
    let pending = sentCheckDialog(labels);
    let [yes, now, cancel] = dom.buttons();
    assert.deepEqual([yes.textContent, now.textContent, cancel.textContent], ['Yes', 'Now', 'Cancel']);
    assert.equal(dom.focused.el, yes, 'the primary answer has the focus');
    yes.fire('click');
    assert.equal(await pending, 'yes');
    assert.equal(dom.focused.el, dom.outside, 'focus restored');
    assert.equal(dom.listeners.document.length, 0, 'the key listener is gone');

    // Send now
    pending = sentCheckDialog(labels);
    [, now] = dom.buttons();
    now.fire('click');
    assert.equal(await pending, 'sendNow');

    // Escape
    pending = sentCheckDialog(labels);
    const event = dom.press('Escape');
    assert.equal(event.prevented, true);
    assert.equal(await pending, null);
    assert.equal(dom.focused.el, dom.outside);

    // Cancel button
    pending = sentCheckDialog(labels);
    [, , cancel] = dom.buttons();
    cancel.fire('click');
    assert.equal(await pending, null);

    // Backdrop tap (a click whose target is the backdrop itself)
    pending = sentCheckDialog(labels);
    const backdrop = dom.body.children[dom.body.children.length - 1];
    backdrop.fire('click');
    assert.equal(await pending, null);

    // Tab stays inside: it moves along the buttons and wraps.
    pending = sentCheckDialog(labels);
    [yes, now, cancel] = dom.buttons();
    dom.press('Tab');
    assert.equal(dom.focused.el, now);
    dom.press('Tab'); dom.press('Tab');
    assert.equal(dom.focused.el, yes);
    dom.press('Escape');
    await pending;

    // No road to send by: the «Send it now» button is not drawn at all.
    pending = sentCheckDialog({ ...labels, sendNowLabel: '' });
    assert.equal(dom.buttons().length, 2);
    dom.press('Escape');
    assert.equal(await pending, null);
  } finally {
    delete globalThis.document;
  }
});

test('the dialog is Orders-only, built on .app-dialog-*, traps focus and treats Escape as cancel', () => {
  const src = read('js/orders/sent-check-dialog.js');
  assert.match(src, /'app-dialog-backdrop'/);
  assert.match(src, /e\.key === 'Escape'/);
  assert.match(src, /e\.key === 'Tab'/);
  assert.match(src, /prevFocus\.focus\(\)/);
  assert.match(src, /backdrop\.addEventListener\('click'/);
  assert.doesNotMatch(src, /innerHTML/);
  // confirm-dialog.js (pinned identical across features) was not touched.
  assert.doesNotMatch(read('js/orders/confirm-dialog.js'), /sendNow/);
});

test('the words exist in both languages, as specified', () => {
  const i18n = read('js/i18n.js');
  const both = (key, en, it) => {
    assert.ok(i18n.includes(`'${key}': ${en},`), `${key} EN`);
    assert.ok(i18n.includes(`'${key}': ${it},`), `${key} IT`);
  };
  both('orders.sentCheck.one', "'Did you send the order to {name}?'", '"Hai inviato l’ordine a {name}?"');
  both('orders.sentCheck.many', "'Did you send the orders to {names}?'", "'Hai inviato gli ordini a {names}?'");
  both('orders.sentCheck.yes', "'Yes, sent'", "'Sì, inviato'");
  both('orders.sentCheck.yesMany', "'Yes, sent'", "'Sì, inviati'");
  both('orders.sentCheck.sendNow', "'Send it now'", "'Invialo ora'");
  both('orders.sentCheck.sendNowMany', "'Send them now'", "'Inviali ora'");
  both('orders.sentCheck.notReached', "'Not sent, still to do: {names}'", "'Non inviati, restano da fare: {names}'");
});
