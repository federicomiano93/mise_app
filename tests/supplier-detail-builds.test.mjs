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

// ── The summary bar at the foot of the screen (owner, 3 Oct 2026) ────────────────────────
// «aggiungi il resoconto dentro la scheda dei fornitori così posso vedere tutto quello che ho
// selezionato senza tornare indietro».
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const barOf = view => byClass(view.overlay, 'supplier-summary-bar');

test('the bar is built with 0 items, after the scrolling body and not inside it', () => {
  const view = buildSupplierDetail(supplier, ctx(() => null));
  const bar = barOf(view);
  assert.ok(bar, 'the bar is always built');
  const kids = view.overlay.children;
  assert.ok(kids.indexOf(bar) > kids.indexOf(byClass(view.overlay, 'supplier-detail-body')),
    'a sibling AFTER the body');
  assert.equal(find(byClass(view.overlay, 'supplier-detail-body'), n => n === bar), null, 'not inside the body');
  const button = bar.children[0];
  assert.equal(button.tagName, 'BUTTON');
  assert.equal(button.getAttribute('type'), 'button');
  assert.equal(button.getAttribute('id'), 'summary-bar-S1');
  assert.equal(button.textContent, '0 items in the order · Summary');
  assert.equal(bar.hidden, false);
});

test('the bar counts the rows with a quantity, not those ordered elsewhere, with the plural words', () => {
  const rows = [
    { id: 'a', name: 'A', supplierId: 'S1' },
    { id: 'b', name: 'B', supplierId: 'S1' },
    { id: 'c', name: 'C', supplierId: 'S1', elsewhereId: 'S2' },
  ];
  const withQty = entries => ({ ...ctx(() => null), ingredients: rows, entries });
  const view = buildSupplierDetail(supplier, withQty({ a: { qty: 1 }, c: { qty: 4 } }));
  assert.equal(barOf(view).children[0].textContent, '1 item in the order · Summary');
  view.repaint(withQty({ a: { qty: 1 }, b: { qty: 2 }, c: { qty: 4 } }));
  assert.equal(barOf(view).children[0].textContent, '2 items in the order · Summary');
});

test('tapping the bar calls the handler with the supplier id', () => {
  const seen = [];
  const view = buildSupplierDetail(supplier, { ...ctx(() => null), onSummary: id => seen.push(id) });
  barOf(view).children[0].fire('click');
  assert.deepEqual(seen, ['S1']);
});

test('wiring: keystrokes update the bar; the summary opens over the supplier and focus returns to the bar', () => {
  const suppliers = read('js/orders/suppliers.js');
  assert.match(suppliers, /summary-bar-text-\$\{supplier\.id\}[\s\S]{0,120}summaryBarLabel\(filled\)/);

  const main = read('js/orders/orders-main.js');
  // \r?: a Windows checkout has CRLF line ends.
  const over = main.match(/function openSummaryOverSupplier\([\s\S]*?\r?\n}\r?\n/)[0];
  assert.doesNotMatch(over, /closeSupplier\(\)/, 'the supplier screen stays open');
  assert.match(main, /onSummary: openSummaryOverSupplier/);
  assert.match(main, /fromBar \? `summary-bar-\$\{openerId\}`/);
  const plain = main.match(/function openSummary\(supplierId\) \{[\s\S]*?\r?\n}\r?\n/)[0];
  assert.match(plain, /closeSupplier\(\)/, 'the list button path is unchanged');

  const css = read('orders.css');
  assert.match(css, /\.order-summary-view\.order-summary--over-supplier \{ z-index: 610; \}/);
  assert.match(css, /\.supplier-summary-icon \{ display: flex; align-items: center;/);

  assert.match(read('js/sw-update.js'), /BOTTOM_BARS = \[[^\]]*'\.supplier-summary-bar'/);
});

// The review fixes of 3 Oct 2026: each one is invisible on a phone tap, so only these keep them.
test('the summary over the supplier screen is a real modal, and leaves nothing behind', () => {
  assert.match(read('js/orders/order-summary-view.js'), /role: 'dialog', 'aria-modal': 'true'/);

  const main = read('js/orders/orders-main.js');
  const fn = name => main.match(new RegExp(`function ${name}\\([\\s\\S]*?\\r?\\n}\\r?\\n`))[0];

  // The screen underneath leaves the tab order only once the sheet is really there…
  assert.match(fn('openSummaryOverSupplier'), /if \(detailView && summaryView\) detailView\.overlay\.inert = true;/);
  // …and every close gives it back BEFORE focus moves to the bar's button (inert refuses focus).
  const close = fn('closeSummary');
  const uninert = close.indexOf('detailView.overlay.inert = false');
  assert.ok(uninert > 0 && uninert < close.indexOf('.focus()'), 'inert cleared before the focus call');
  // An Escape a dialog above already used closes only that dialog.
  assert.match(main, /summaryEscHandler = e => \{ if \(e\.key !== 'Escape' \|\| e\.defaultPrevented\) return; closeSummary\(\); \}/);
  // Whatever closes the supplier screen takes the summary over it along, and focus lands on the list row.
  const closeSup = fn('closeSupplier');
  assert.match(closeSup, /if \(hadSummary\) closeSummary\(\);/);
  assert.ok(closeSup.indexOf('closeSummary()') < closeSup.indexOf('overlay.remove()'), 'closed while the screen is still there');
  assert.match(closeSup, /if \(hadSummary && id\) document\.getElementById\(`open-\$\{id\}`\)\?\.focus\(\);/);
});

test('phone layout of the summary: the cost drops onto its own line, the tablet column is untouched', () => {
  const css = read('orders.css');
  const at = css.indexOf('@media (max-width: 899px) {\r\n  .order-summary-row') >= 0
    ? css.indexOf('@media (max-width: 899px) {\r\n  .order-summary-row')
    : css.indexOf('@media (max-width: 899px) {\n  .order-summary-row');
  assert.ok(at > 0, 'the phone block exists');
  const phone = css.slice(at, css.indexOf('\n}', at));
  assert.match(phone, /\.order-summary-row \{ flex-wrap: wrap;/);
  assert.match(phone, /\.order-summary-qty-wrap \{ display: contents; \}/);
  assert.match(phone, /\.order-summary-cost \{[^}]*flex: 0 0 100%;[^}]*overflow-wrap: anywhere;/);
});

test('both languages have the bar phrase with the plural pair', () => {
  const dict = read('js/i18n.js');
  const entries = [...dict.matchAll(/'orders\.summaryBar': \{ one: '([^']*)', other: '([^']*)' \}/g)];
  assert.equal(entries.length, 2, 'EN and IT');
  for (const [, one, other] of entries) {
    assert.ok(one.includes('{n}') && other.includes('{n}'));
  }
  assert.match(entries[1][1], /^{n} articolo nell’ordine/);
  assert.match(entries[1][2], /^{n} articoli nell’ordine/);
});

// His decision, 4 Oct 2026: the summary's total warnings say «articoli», like its bar and title.
test('the summary warnings say «articolo / articoli» in Italian, agreed in gender', () => {
  const dict = read('js/i18n.js');
  assert.match(dict, /'orders\.cost\.missingPrice': \{ one: '\{n\} articolo senza prezzo, non incluso:[^']*',\s*other: '\{n\} articoli senza prezzo, non inclusi:/);
  assert.match(dict, /'orders\.cost\.missingVatTotal': \{ one: '\{n\} articolo senza IVA indicata[^']*',\s*other: '\{n\} articoli senza IVA indicata/);
});

// His decision, 4 Oct 2026: the supplier list's count says «articoli» too (and so the History
// and supplier-picker rows that share it), like the summary bar.
test('the item count says «articolo / articoli» in Italian', () => {
  const dict = read('js/i18n.js');
  assert.match(dict, /'orders\.itemsCount': \{ one: '\{n\} articolo', other: '\{n\} articoli' \}/);
  assert.match(dict, /'orders\.itemsCount': \{ one: '\{n\} item', other: '\{n\} items' \}/);
});
