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

test('no day to say: the line exists and is hidden', () => {
  const view = buildSupplierDetail(supplier, ctx(() => null));
  const line = byClass(view.overlay, 'supplier-day-line');
  assert.ok(line, 'the day line is always built');
  assert.equal(line.hidden, true);
  assert.equal(view.refreshDay(), false);
});

test('a future day: the words, the button and its full accessible name', () => {
  let tapped = 0;
  const view = buildSupplierDetail(supplier, ctx(() => ({
    text: 'Ordine per domenica 4 ottobre', buttonLabel: 'Per oggi', onClick: () => { tapped++; },
  })));
  const line = byClass(view.overlay, 'supplier-day-line');
  const button = byClass(line, 'supplier-day-btn');
  assert.equal(line.hidden, false);
  assert.equal(byClass(line, 'supplier-day-text').textContent, 'Ordine per domenica 4 ottobre');
  assert.equal(button.textContent, 'Per oggi');
  assert.equal(button.getAttribute('aria-label'), 'Ordine per domenica 4 ottobre: Per oggi');
  button.fire('click');
  assert.equal(tapped, 1);
});

test('the line follows a refresh, and the result is announced on the screen', () => {
  let info = { text: 'Ordine per oggi', buttonLabel: 'Sposta a mer 7', onClick() {} };
  const view = buildSupplierDetail(supplier, ctx(() => info));
  assert.equal(view.refreshDay(), true);
  info = null;
  assert.equal(view.refreshDay(), false);
  view.announce('Ordine spostato a oggi');
  assert.equal(byClass(view.overlay, 'supplier-day-live').textContent, 'Ordine spostato a oggi');
});
