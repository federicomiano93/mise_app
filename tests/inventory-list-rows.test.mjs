// The counting list: typing a number must not rebuild the list.
//
// ⚠️⚠️ WHAT THIS CLOSES, AND WHY IT NEEDED EXECUTING RATHER THAN READING. Every
// box on this screen runs setCount → the store saves and announces → refresh(),
// synchronously, inside the `change` handler — which fires the instant a finger
// leaves one box for the next. The list rebuilt itself there: `replaceChildren()`
// on the row container. The tap then landed on a node that no longer existed, the
// keyboard closed, and the number the finger was on its way to was lost. Sixty-
// seven times, on the one screen somebody spends an hour on.
//
// No test that reads the file can see this: `replaceChildren` appears in the
// rebuild either way, and whether it runs on a count depends on control flow. So
// this file RENDERS the list against a small DOM of its own, types into a box, and
// asserts that the nodes are the SAME OBJECTS afterwards — the only statement that
// actually means "the box under the finger survived".
//
// ⚠️ THE ANTI-VACUOUS GUARD IS THE POINT, NOT DECORATION (same lesson as
// tests/precache-install.test.mjs): a harness that rendered nothing would pass
// every identity check below, because two empty lists are trivially equal. The
// first test therefore proves the rows exist and that a count reaches the screen.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── A DOM just complete enough for js/inventory/dom.js and the list ──────────

class ClassList {
  constructor() { this.set = new Set(); }
  add(...names) { names.forEach(n => n && this.set.add(n)); }
  remove(...names) { names.forEach(n => this.set.delete(n)); }
  contains(name) { return this.set.has(name); }
  toggle(name, on) { if (on) this.add(name); else this.remove(name); return this.contains(name); }
}

class Node {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.dataset = {};
    this.style = {};
    this.classList = new ClassList();
    this._text = null;
  }

  get className() { return [...this.classList.set].join(' '); }
  set className(value) {
    this.classList = new ClassList();
    this.classList.add(...String(value).split(/\s+/));
  }

  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() {
    if (this._text !== null) return this._text;
    return this.children.map(c => c.textContent).join('');
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    // A fresh input reflects its value attribute into its value property, which is
    // how the first paint puts a count in the box.
    if (name === 'value') this.value = String(value);
  }

  getAttribute(name) { return this.attributes[name]; }
  appendChild(child) { this.children.push(child); return child; }
  append(...nodes) { nodes.forEach(n => this.appendChild(n)); }
  replaceChildren(...nodes) { this.children = []; nodes.forEach(n => this.appendChild(n)); }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  fire(type, event = {}) { (this.listeners[type] || []).forEach(fn => fn({ target: this, ...event })); }
}

class Text extends Node {
  constructor(text) { super('#text'); this._text = String(text); }
}

globalThis.document = {
  createElement: tag => new Node(tag),
  createTextNode: text => new Text(text),
  activeElement: null,
};

// Imported AFTER the document exists: js/inventory/dom.js calls
// document.createElement the moment the list is built.
const { renderList } = await import('../js/inventory/inventory-list.js');
const { normalizeMonth } = await import('../js/inventory/inventory-model.js');

// Everything in the tree, so a row can be found without a real querySelector.
function walk(node, out = []) {
  out.push(node);
  node.children.forEach(child => walk(child, out));
  return out;
}

const withClass = (root, name) => walk(root).filter(n => n.classList.contains(name));
const rowsOf = root => withClass(root, 'inv-row');
const boxesOf = root => withClass(root, 'inv-count');
const listOf = root => withClass(root, 'inv-list')[0];
const textOf = (root, name) => withClass(root, name).map(n => n.textContent);

const product = (id, over = {}) => ({ id, name: id, weight: '1kg', category: 'Dry', ...over });
const THREE = [product('flour'), product('salt'), product('sugar')];
const month = (closing = {}) => normalizeMonth({
  month: '2026-09',
  opening: { flour: 10, salt: 10, sugar: 10 },
  closing,
});

// The screen as inventory-main.js wires it: a count goes to the store, and the
// store announces, which calls refresh() with the new month. Synchronously.
function mount(products = THREE, options = {}) {
  let current = month(options.closing || {});
  const counts = [];
  const list = renderList({
    month: current,
    ingredients: products,
    locale: 'it-IT',
    readOnly: false,
    onOpen: () => {},
    onCarry: () => {},
    onPurchases: () => {},
    onCount: (id, value) => {
      counts.push([id, value]);
      const closing = { ...current.closing };
      if (String(value).trim() === '') delete closing[id];
      else closing[id] = Number(String(value).replace(',', '.'));
      current = month(closing);
      // This is the line the whole file is about: the store announces while the
      // finger is still moving between two boxes.
      list.refresh(current, products);
    },
  });
  return { list, counts, ingredients: products, at: () => current };
}

// ── The harness itself works ─────────────────────────────────────────────────

test('the list renders a row per product, and a typed count reaches the screen', () => {
  const { list, counts } = mount();
  assert.equal(rowsOf(list.root).length, 3, 'three products, three rows');
  assert.equal(boxesOf(list.root).length, 3);
  assert.match(textOf(list.root, 'inv-summary-value')[0], /0 su 3|0 of 3/);

  boxesOf(list.root)[0].fire('change', { target: { value: '4' } });
  assert.deepEqual(counts, [['flour', '4']], 'the change handler is wired to the store');
  assert.match(textOf(list.root, 'inv-summary-value')[0], /1 su 3|1 of 3/,
    'and the screen shows the count went in');
});

// ── The defect ───────────────────────────────────────────────────────────────

test('⚠️⚠️ typing a count leaves every row node exactly where it was', () => {
  const { list } = mount();
  const before = rowsOf(list.root);
  const boxesBefore = boxesOf(list.root);

  boxesBefore[0].fire('change', { target: { value: '4' } });

  const after = rowsOf(list.root);
  assert.equal(after.length, before.length);
  after.forEach((node, i) => assert.equal(node, before[i],
    'a rebuilt row is a NEW object — and the tap heading for it lands on nothing'));
  boxesOf(list.root).forEach((box, i) => assert.equal(box, boxesBefore[i],
    'the box being reached for must be the same input, not a replacement'));
});

test('⚠️ and that holds for the box the finger is actually heading for', () => {
  // The real sequence: the count is committed by the BLUR caused by tapping the
  // next box. If that next box is replaced in the same tick, the tap is lost.
  const { list } = mount();
  const next = boxesOf(list.root)[1];
  boxesOf(list.root)[0].fire('change', { target: { value: '2' } });
  assert.equal(boxesOf(list.root)[1], next);
});

test('the row does update: it says counted, and what the answer is', () => {
  const { list } = mount();
  const row = rowsOf(list.root)[0];
  assert.equal(row.classList.contains('counted'), false);

  boxesOf(list.root)[0].fire('change', { target: { value: '4' } });

  assert.equal(row.classList.contains('counted'), true, 'in place, on the same node');
  const sub = withClass(row, 'inv-row-sub')[0];
  assert.match(sub.textContent, /6/, 'had 10, bought none, 4 left → used 6');
  assert.equal(sub.classList.contains('todo'), false);
});

test('the count box is written back in the venue\'s own format, once the finger has left', () => {
  const { list } = mount();
  const box = boxesOf(list.root)[0];
  box.fire('change', { target: { value: '3.5' } });
  assert.equal(box.value, '3,5', 'Italian reads three and a half with a comma');
});

test('⚠️ the box being typed into is never written into while it has the focus', () => {
  // Enter commits a count without moving the focus. Rewriting the input then would
  // jump the caret to the end in the middle of a number.
  const { list } = mount();
  const box = boxesOf(list.root)[0];
  box.value = '3,';
  document.activeElement = box;
  try {
    box.fire('change', { target: { value: '3' } });
    assert.equal(box.value, '3,', 'left exactly as it was typed');
  } finally {
    document.activeElement = null;
  }
});

test('⚠️ with «still to count» on, a row that has just been counted STAYS', () => {
  // It is the same bug wearing a filter: dropping the row the instant its number
  // is typed takes the next box away from under the finger. It is marked counted
  // and stays put until the next search, filter tap or reload.
  const { list } = mount();
  withClass(list.root, 'inv-filter')[0].fire('click');
  assert.equal(rowsOf(list.root).length, 3, 'nothing is counted yet, so all three show');

  const before = rowsOf(list.root);
  boxesOf(list.root)[0].fire('change', { target: { value: '4' } });
  assert.deepEqual(rowsOf(list.root), before);
  assert.equal(rowsOf(list.root)[0].classList.contains('counted'), true);

  // And the filter still does its job the next time it is asked.
  withClass(list.root, 'inv-filter')[0].fire('click');
  withClass(list.root, 'inv-filter')[0].fire('click');
  assert.equal(rowsOf(list.root).length, 2, 'the counted one is gone on a fresh build');
});

// ── What MUST still rebuild ──────────────────────────────────────────────────

test('a product arriving from Firestore appears', () => {
  // The ingredients land a moment after the first paint, every single time.
  const { list } = mount();
  list.refresh(month(), [...THREE, product('yeast')]);
  assert.equal(rowsOf(list.root).length, 4);
});

test('a product that has gone away leaves the screen', () => {
  const { list } = mount();
  list.refresh(month(), [THREE[0], THREE[1]]);
  assert.deepEqual(textOf(list.root, 'inv-row-name'), ['flour 1kg', 'salt 1kg']);
});

test('a search rebuilds the list, and clearing it brings everything back', () => {
  const { list } = mount();
  withClass(list.root, 'inv-search')[0].fire('input', { target: { value: 'sal' } });
  assert.deepEqual(textOf(list.root, 'inv-row-name'), ['salt 1kg']);
  withClass(list.root, 'inv-search')[0].fire('input', { target: { value: '' } });
  assert.equal(rowsOf(list.root).length, 3);
});

test('a product renamed elsewhere gets its new name without the list being rebuilt', () => {
  const { list } = mount();
  const before = rowsOf(list.root);
  list.refresh(month(), [product('flour', { name: 'Farina 0' }), THREE[1], THREE[2]]);
  assert.deepEqual(rowsOf(list.root), before, 'a rename is not a reason to move the rows');
  assert.equal(textOf(list.root, 'inv-row-name')[0], 'Farina 0 1kg');
});

test('an empty list says so, and stops saying so when a product arrives', () => {
  const { list } = mount([]);
  assert.equal(rowsOf(list.root).length, 0);
  assert.equal(withClass(list.root, 'inv-empty').length, 1);
  list.refresh(month(), THREE);
  assert.equal(withClass(list.root, 'inv-empty').length, 0);
  assert.equal(rowsOf(list.root).length, 3);
});

test('a closed month draws no count boxes anybody can type into', () => {
  const list = renderList({
    month: normalizeMonth({ month: '2026-09', closing: { flour: 2 }, closedAt: 'yes' }),
    ingredients: THREE,
    locale: 'it-IT',
    readOnly: true,
    onOpen: () => {}, onCount: () => {}, onCarry: () => {}, onPurchases: () => {},
  });
  assert.equal(rowsOf(list.root).length, 3);
  boxesOf(list.root).forEach(box => assert.equal(box.getAttribute('disabled'), 'disabled'));
  assert.equal(withClass(list.root, 'inv-actions').length, 0,
    'and none of the fill-in actions either');
});

test('the rows land inside the list container, not loose in the view', () => {
  // A guard on the harness: every identity check above would also pass if the rows
  // were never attached to anything.
  const { list } = mount();
  assert.equal(listOf(list.root).children.filter(n => n.classList.contains('inv-row')).length, 3);
});

test('⚠️ a row whose category arrives late is re-filed under it', () => {
  // The products land a moment after the first paint, so the first rows are drawn
  // with nothing to file them under. A closed month — whose rows come from the
  // frozen list rather than from the live one — kept every row under «No category»
  // for ever, because an in-place update cannot move a row between headings.
  const { list } = mount([product('flour', { category: '' }), product('salt', { category: '' })]);
  assert.equal(textOf(list.root, 'inv-group').length, 1, 'one heading, whatever it is called');

  list.refresh(month(), [product('flour', { category: 'Dry' }), product('salt', { category: 'Fresh' })]);
  assert.deepEqual(textOf(list.root, 'inv-group').sort(), ['Dry', 'Fresh']);
  assert.equal(rowsOf(list.root).length, 2);
});

test('and a count still does not re-file anything', () => {
  const { list } = mount();
  const before = rowsOf(list.root);
  boxesOf(list.root)[0].fire('change', { target: { value: '4' } });
  assert.deepEqual(rowsOf(list.root), before);
});
