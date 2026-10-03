// The supplier's order screen is BUILT, not only read as text.
//
// ⚠️ WHY THIS EXISTS (3 Oct 2026). A live region added to js/orders/supplier-detail.js was
// declared after the overlay that used it: a TDZ crash, so tapping ANY supplier did nothing
// at all — the one screen Orders exists for. Every test was green, because none of them
// ever ran buildSupplierDetail(); it was found by driving the app. This builds the screen
// against a small DOM of its own (same idea as tests/orders-edit-ingredient.test.mjs) and
// checks the day line's three states.

import { test } from 'node:test';
import assert from 'node:assert/strict';

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
    this.hidden = false;
    this.disabled = false;
    this._text = null;
  }
  get className() { return [...this.classList.set].join(' '); }
  set className(value) { this.classList = new ClassList(); this.classList.add(...String(value).split(/\s+/)); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text !== null ? this._text : this.children.map(c => c.textContent).join(''); }
  set innerHTML(value) { this._html = String(value); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  removeAttribute(name) { delete this.attributes[name]; }
  appendChild(child) { this.children.push(child); return child; }
  append(...kids) { kids.forEach(k => this.appendChild(k)); }
  replaceChildren(...kids) { this.children = []; this._text = null; this.append(...kids); }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  fire(type) { (this.listeners[type] || []).forEach(fn => fn({ target: this, detail: 1 })); }
  dispatch(type, value) { this.value = value; this.fire(type); }
  // As in a browser: assigning a value that is not an option leaves the select with none.
  get value() { return this._value; }
  set value(v) {
    const options = this.children.filter(c => c.tagName === 'OPTION');
    this._value = this.tagName === 'SELECT' && !options.some(o => o.getAttribute('value') === String(v))
      ? '' : String(v);
  }
  querySelector(sel) { return find(this, n => n.tagName === sel.toUpperCase()) || null; }
  focus() { globalThis.document.activeElement = this; }
}
class Text extends Node { constructor(text) { super('#text'); this._text = String(text); } }

function find(node, pred) {
  for (const c of node.children || []) {
    if (pred(c)) return c;
    const deep = find(c, pred);
    if (deep) return deep;
  }
  return null;
}
const byClass = (root, cls) => find(root, n => n.classList?.contains(cls));

globalThis.document = {
  createElement: tag => new Node(tag),
  createTextNode: text => new Text(text),
  activeElement: null,
};

const { buildSupplierDetail } = await import('../js/orders/supplier-detail.js');

const supplier = { id: 'S1', name: 'Brava Fresh' };
const ctx = (dayInfo) => ({
  ingredients: [], entries: {}, suggest: () => ({ active: false }),
  hooks: { onPlaced() {}, afterChange() {} },
  dayInfo,
});

test('⚠️ the supplier screen builds at all (a crash here means no supplier opens)', () => {
  assert.doesNotThrow(() => buildSupplierDetail(supplier, ctx(() => null)));
});

const info = (over = {}) => () => ({
  label: 'Ordine:',
  options: [
    { value: 'today', label: 'Oggi' },
    { value: 'next', label: 'Prossimo ordine (gio 8)' },
  ],
  selected: 'today',
  deliveryText: 'Consegna prevista: lunedì 12 ottobre',
  onChange() {},
  ...over,
});
const optionsOf = select => select.children.map(o => [o.getAttribute('value'), o.textContent]);

test('a supplier with no order days: the line exists and is hidden', () => {
  const view = buildSupplierDetail(supplier, ctx(() => null));
  const line = byClass(view.overlay, 'supplier-day-line');
  assert.ok(line, 'the day line is always built');
  assert.equal(line.hidden, true);
  assert.equal(view.refreshDay(), false);
});

test('the line: a labelled select with the two answers, the selected one and the delivery', () => {
  const view = buildSupplierDetail(supplier, ctx(info({ selected: 'next' })));
  const line = byClass(view.overlay, 'supplier-day-line');
  const select = byClass(line, 'supplier-day-select');
  const label = byClass(line, 'supplier-day-label');
  assert.equal(line.hidden, false);
  assert.equal(select.tagName, 'SELECT');
  assert.equal(label.textContent, 'Ordine:');
  assert.equal(label.getAttribute('for'), select.getAttribute('id'), 'the label names the select');
  assert.deepEqual(optionsOf(select), [['today', 'Oggi'], ['next', 'Prossimo ordine (gio 8)']]);
  assert.equal(select.value, 'next');
  assert.ok(optionsOf(select).some(([value]) => value === select.value), 'the selected option is a real one');
  const delivery = byClass(line, 'supplier-day-delivery');
  assert.equal(delivery.textContent, 'Consegna prevista: lunedì 12 ottobre');
  assert.equal(delivery.hidden, false);
});

test('no delivery days: the delivery text is hidden', () => {
  const view = buildSupplierDetail(supplier, ctx(info({ deliveryText: '' })));
  assert.equal(byClass(view.overlay, 'supplier-day-delivery').hidden, true);
});

test('changing the select calls the handler with the chosen value', () => {
  const seen = [];
  const view = buildSupplierDetail(supplier, ctx(info({ onChange: v => seen.push(v) })));
  byClass(view.overlay, 'supplier-day-select').dispatch('change', 'next');
  assert.deepEqual(seen, ['next']);
});

test('the line follows a refresh (select and delivery), and the result is announced', () => {
  let current = { selected: 'today', deliveryText: 'A' };
  const view = buildSupplierDetail(supplier, ctx(() => info(current)()));
  const line = byClass(view.overlay, 'supplier-day-line');
  current = { selected: 'next', deliveryText: 'B' };
  assert.equal(view.refreshDay(), true);
  assert.equal(byClass(line, 'supplier-day-select').value, 'next');
  assert.equal(byClass(line, 'supplier-day-delivery').textContent, 'B');
  view.announce('Ordine per oggi');
  assert.equal(byClass(view.overlay, 'supplier-day-live').textContent, 'Ordine per oggi');
});

test('a snapshot repaint gives the focus back to the day select', () => {
  const view = buildSupplierDetail(supplier, ctx(info()));
  byClass(view.overlay, 'supplier-day-select').focus();
  view.repaint(ctx(info()));
  const fresh = byClass(view.overlay, 'supplier-day-select');
  assert.equal(globalThis.document.activeElement, fresh);
});
