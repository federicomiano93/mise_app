// The «did it go?» banner (js/orders/reminder-view.js renderAwaiting) rebuilds a row when the busy
// state changes. Keyboard and screen-reader focus must survive that: tapping «Sì» used to rebuild
// the row and drop focus to <body>. Executed against the small DOM in tests/helpers/form-dom.mjs.

import { test } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { installDom, walk, Node } from './helpers/form-dom.mjs';

installDom();
const tabButton = new Node('button');
globalThis.document.getElementById = id => (id === 'tab-order-btn' ? tabButton : null);
const { renderAwaiting, refocusAwaiting } = await import('../js/orders/reminder-view.js');

const AT = '2026-11-14T10:42:00.000Z';
const list = [
  { supplier: { id: 'S1', name: 'Bruno' }, at: AT, quantities: { a: 1 } },
  { supplier: { id: 'S2', name: 'Carla' }, at: AT, quantities: { b: 1 } },
];
const buttons = host => walk(host).filter(n => n.tagName === 'BUTTON');
const button = (host, supplier, answer) => buttons(host)
  .find(b => b.dataset.awaitingSupplier === supplier && b.dataset.awaitingAnswer === answer);
// Focus as a browser does it: only the node that was focused is the active element.
const focusOn = node => { globalThis.document.activeElement = node; };

function draw(host, busyIds, calls = []) {
  renderAwaiting(host, list, {
    question: s => `Order to ${s.name}?`,
    onYes: (id, at) => calls.push(['yes', id, at]),
    onNo: (id, at) => calls.push(['no', id, at]),
    busy: id => busyIds.includes(id),
  });
}

test('⚠️ focus on «Sì» survives the rebuild when the answer goes busy, and again when it ends', () => {
  const host = new Node('div');
  draw(host, []);
  const yes = button(host, 'S1', 'yes');
  focusOn(yes);
  const before = button(host, 'S1', 'yes');
  draw(host, ['S1']);
  const after = button(host, 'S1', 'yes');
  assert.notEqual(after, before, 'the row really was rebuilt');
  assert.equal(after.focused, 1, 'focus put back on the same answer of the same supplier');
  assert.equal(button(host, 'S1', 'no').focused, 0);
  assert.equal(button(host, 'S2', 'yes').focused, 0, 'not the other supplier\'s button');
  focusOn(after);
  draw(host, []);
  assert.equal(button(host, 'S1', 'yes').focused, 1, 'and once more when the question comes back');
});

test('«No» keeps its own focus; nothing is focused when focus was elsewhere', () => {
  const host = new Node('div');
  draw(host, []);
  focusOn(button(host, 'S2', 'no'));
  draw(host, ['S2']);
  assert.equal(button(host, 'S2', 'no').focused, 1);
  assert.equal(button(host, 'S2', 'yes').focused, 0);
  const other = new Node('input');
  focusOn(other);
  draw(host, []);
  assert.equal(buttons(host).reduce((n, b) => n + b.focused, 0), 0, 'never steals focus from a field');
});

test('while answering the buttons stay focusable (aria-disabled) and a tap does nothing', () => {
  const host = new Node('div');
  const calls = [];
  draw(host, ['S1'], calls);
  const yes = button(host, 'S1', 'yes');
  assert.equal(yes.getAttribute('aria-disabled'), 'true');
  assert.equal(yes.disabled, false, 'a disabled button could not hold focus');
  yes.fire('click');
  button(host, 'S1', 'no').fire('click');
  assert.deepEqual(calls, []);
  button(host, 'S2', 'yes').fire('click');
  assert.deepEqual(calls, [['yes', 'S2', AT]], 'the other supplier is not busy');
  draw(host, [], calls);
  assert.equal(button(host, 'S1', 'yes').getAttribute('aria-disabled'), undefined);
});

const drawList = (host, entries, busyIds = []) => renderAwaiting(host, entries, {
  question: s => `Order to ${s.name}?`, onYes() {}, onNo() {}, busy: id => busyIds.includes(id),
});

test('⚠️ the answered row is removed: focus goes to the next row’s «Sì», else to the Orders tab', () => {
  const host = new Node('div');
  drawList(host, list);
  focusOn(button(host, 'S1', 'yes'));
  drawList(host, [list[1]]);                       // S1 recorded elsewhere: its row is gone
  assert.equal(button(host, 'S2', 'yes').focused, 1, 'the next row’s «Sì»');
  assert.equal(tabButton.focused, 0);
  focusOn(button(host, 'S2', 'no'));
  drawList(host, []);                              // the last row goes
  assert.equal(tabButton.focused, 1, 'a stable control above the banner, never <body>');
});

test('the focused row is the LAST of several and goes: nothing after it, so the Orders tab', () => {
  const host = new Node('div');
  tabButton.focused = 0;
  drawList(host, list);
  focusOn(button(host, 'S2', 'yes'));
  drawList(host, [list[0]]);
  assert.equal(tabButton.focused, 1);
  assert.equal(button(host, 'S1', 'yes').focused, 0);
});

test('a dialog that gave focus back to a detached button: refocusAwaiting finds the live one', () => {
  const host = new Node('div');
  tabButton.focused = 0;
  drawList(host, list);
  drawList(host, list, ['S1']);                    // rebuilt while the dialog was open
  refocusAwaiting(host, { supplier: 'S1', answer: 'yes' });
  assert.equal(button(host, 'S1', 'yes').focused, 1);
  refocusAwaiting(host, { supplier: 'S9', answer: 'yes' });
  assert.equal(tabButton.focused, 1, 'row gone meanwhile: the Orders tab');
  const html = fs.readFileSync(new URL('../orders.html', import.meta.url), 'utf8');
  assert.match(html, /id="tab-order-btn"/, 'the fallback exists on the page');
});
