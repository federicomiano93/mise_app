// Tap an ingredient's NAME in Orders to open «Modifica ingrediente» (1 Oct 2026).
//
// Federico: «voglio accedere alla scheda modifica ingrediente dalla scheda ordini così non devo
// tornare indietro nella scheda ingredienti e fornitori».
//
// What can go wrong without anything looking broken: a name that is a button for somebody who
// may not edit (a control that opens a card they cannot use), a button that swallows the
// quantity boxes, and — the one that costs money — a card opened WITHOUT the stored price, whose
// untouched Save then erases it. The row is EXECUTED against a small DOM of its own (same idea
// as tests/inventory-list-rows.test.mjs); the price chain is pure and proved directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withPrices, pricePatch, priceChanged } from '../js/price-model.js';
import { itemWithPrice, needsPriceRead } from '../js/ingredient-edit-model.js';

const read = (name) => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── A DOM just complete enough for js/orders/dom.js and buildRow ─────────────

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

  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  fire(type, event = {}) { (this.listeners[type] || []).forEach(fn => fn({ target: this, detail: 1, ...event })); }
}

class Text extends Node {
  constructor(text) { super('#text'); this._text = String(text); }
}

globalThis.document = {
  createElement: tag => new Node(tag),
  createTextNode: text => new Text(text),
  activeElement: null,
};

// Imported AFTER the document exists, like the other executed-DOM tests.
const { buildRow } = await import('../js/orders/ingredients.js');

function walk(node, out = []) {
  out.push(node);
  node.children.forEach(child => walk(child, out));
  return out;
}
const withClass = (root, name) => walk(root).filter(n => n.classList.contains(name));

const FLOUR = { id: 'flour', name: 'Strong flour', weight: '25kg', unit: 'sacco', supplierId: 's1' };
const SUPPLIER = { id: 's1', name: 'Mills Ltd' };

function row(hooksExtra = {}) {
  const hooks = { afterChange: () => {}, ...hooksExtra };
  return { node: buildRow(FLOUR, SUPPLIER, () => ({ active: false }), {}, hooks) };
}

// ── The name is a button only where editing is allowed ───────────────────────

test('the name stays plain text when nothing hands in the edit door', () => {
  const { node } = row();
  const [name] = withClass(node, 'ing-name');
  assert.equal(name.tagName, 'SPAN');
  assert.equal(name.textContent, 'Strong flour');
  assert.equal(withClass(node, 'ing-name-btn').length, 0);
});

test('⚠️ the name stays plain text when the person may not edit ingredients', () => {
  const opened = [];
  const { node } = row({ mayEditIngredient: () => false, onEditIngredient: ing => opened.push(ing) });
  const [name] = withClass(node, 'ing-name');
  assert.equal(name.tagName, 'SPAN', 'a button here would open a card the person may not use');
  assert.equal(name.listeners.click, undefined);
});

test('the name is a real button when editing is allowed, and tapping it opens THAT ingredient', () => {
  const opened = [];
  const { node } = row({ mayEditIngredient: () => true, onEditIngredient: ing => opened.push(ing) });
  const [name] = withClass(node, 'ing-name');
  assert.equal(name.tagName, 'BUTTON', 'keyboard reachable and announced as a button');
  assert.equal(name.getAttribute('type'), 'button');
  assert.ok(name.classList.contains('ing-name-btn'), 'the class that makes it look like the plain name');
  assert.equal(name.textContent, 'Strong flour', 'it still reads as the name');
  assert.match(name.getAttribute('aria-label'), /Strong flour/, 'its accessible name says which ingredient');
  name.fire('click');
  assert.deepEqual(opened, [FLOUR]);
});

test('the name button holds nothing else: the boxes, the × and the unit are its siblings', () => {
  const { node } = row({ mayEditIngredient: () => true, onEditIngredient: () => {} });
  const [name] = withClass(node, 'ing-name');
  assert.equal(name.children.length, 0, 'no input or button nested in the name button');
  for (const cls of ['ing-qty', 'ing-stock', 'ing-qty-clear']) {
    const [other] = withClass(node, cls);
    assert.ok(other, `${cls} is still on the row`);
    assert.ok(!walk(name).includes(other), `${cls} must not sit inside the name button`);
  }
});

// ── The price survives an untouched Save ─────────────────────────────────────

const STORED_PRICE = {
  bakery: 'main', priceUnit: 'kg', pricePerUnit: 0.72, unitWeightKg: null, vatRate: 4,
  priceUpdatedAt: '2026-09-01T10:00:00.000Z',
};

// What the card's price block hands pricePatch when nobody touched a box: the stored fields.
function untouchedSave(item) {
  return pricePatch({
    priceUnit: item.priceUnit, pricePerUnit: item.pricePerUnit,
    unitWeightKg: item.unitWeightKg, vatRate: item.vatRate,
  }, '2026-10-01T09:00:00.000Z', item.weight);
}

test('⚠️⚠️ an ingredient opened from Orders with its stored price saves untouched with the price as it was', () => {
  const merged = withPrices([FLOUR], { flour: STORED_PRICE })[0];   // what Orders holds in state.ingredients
  const patch = untouchedSave(merged);
  assert.equal(patch.pricePerUnit, 0.72);
  assert.equal(patch.priceUnit, 'kg');
  assert.equal(patch.vatRate, 4, 'the VAT survives as well');
  assert.equal(priceChanged(merged, patch), false, 'no new history entry for a price that did not move');
});

test('the same ingredient opened WITHOUT its price would erase it — which is why the card never opens so', () => {
  const bare = itemWithPrice(FLOUR, null);
  const patch = untouchedSave(bare);
  assert.equal(patch.pricePerUnit, null, 'an empty card writes «no price» over the stored one');
  assert.equal(priceChanged(bare, patch), false, 'and nothing flags it: the bug is silent');
});

test('itemWithPrice merges the price document exactly as the live price map does', () => {
  const viaOpener = itemWithPrice(FLOUR, STORED_PRICE);
  const viaMap = withPrices([FLOUR], { flour: STORED_PRICE })[0];
  assert.deepEqual(viaOpener, viaMap);
  assert.equal(viaOpener.pricePerUnit, 0.72);
  // A legacy price key still on the ingredient document is replaced, never left to disagree.
  const legacy = itemWithPrice({ ...FLOUR, pricePerUnit: 9 }, STORED_PRICE);
  assert.equal(legacy.pricePerUnit, 0.72);
  assert.equal(itemWithPrice(null, STORED_PRICE), null);
});

test('the price is read only for somebody who may write prices, and only while the snapshot has not answered', () => {
  assert.equal(needsPriceRead({ mayPrice: true, pricesLoaded: false }), true);
  assert.equal(needsPriceRead({ mayPrice: true, pricesLoaded: true }), false, 'Orders already holds it');
  assert.equal(needsPriceRead({ mayPrice: false, pricesLoaded: false }), false, 'no price block, nothing to erase, nothing to read');
  assert.equal(needsPriceRead({}), false);
});

// ── Wiring, pinned ────────────────────────────────────────────────────────────

const CREATE = codeOf(read('js/ingredient-create.js'));
const MAIN = codeOf(read('js/orders/orders-main.js'));

test('the edit opener reads the price BEFORE it draws, and fails closed', () => {
  const edit = CREATE.slice(CREATE.indexOf('export async function openIngredientEdit'));
  const read = edit.indexOf('readIngredientPrice(item.id)');
  const draw = edit.indexOf('buildIngredientForm(');
  assert.ok(read > 0 && draw > read, 'the price is awaited before the card is built');
  assert.match(edit, /needsPriceRead\(\{ mayPrice, pricesLoaded \}\)/);
  assert.match(edit, /mayPrice,\s+panels:/, 'the card is told the same mayPrice it was opened for');
  assert.match(edit, /packPhotoOn: \(\) => false,/, 'the paid packet photo stays on Fornitori');
  assert.doesNotMatch(CREATE, /from '\.\/(orders|catalogue)\//, 'js/ root imports no feature folder');
  assert.doesNotMatch(CREATE, /openIngredientEdit[\s\S]*catch/, 'a failed price read must reach the caller, not be swallowed');
});

test('Orders opens it over the current screen with the same gate and guard as «+ Add ingredient»', () => {
  assert.match(MAIN, /mayEditIngredient: \(\) => mayAddIngredient\(\),/);
  assert.match(MAIN, /function openEditIngredient\(ing\) \{\s*if \(addingIngredient \|\| !mayAddIngredient\(\)\) return;/);
  assert.match(MAIN, /const item = state\.ingredients\.find\(i => i\.id === ing\.id\) \|\| ing;/, 'the merged item, with its price');
  assert.match(MAIN, /pricesLoaded: state\.pricesReadable === true,/);
  assert.match(MAIN, /priceHistory: \(id\) => getPriceHistory\(id\),/);
  assert.match(MAIN, /layerClass: 'mgmt-overlay',[\s\S]*layerClass: 'mgmt-overlay',/, 'both openers use Orders\' own layer (z 650)');
  assert.doesNotMatch(MAIN, /ingredient-record-form\.js/, 'never the card directly');
});

test('the words exist in English and Italian, and the button style keeps the row looking the same', () => {
  const dict = read('js/i18n.js');
  assert.equal(dict.split("'orders.editIngredientFor':").length - 1, 2);
  assert.match(dict, /'orders\.editIngredientFor': 'Edit \{name\}'/);
  assert.match(dict, /'orders\.editIngredientFor': 'Modifica \{name\}'/);
  const css = read('orders.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const at = css.indexOf('.ing-row--line .ing-name-btn {');
  assert.ok(at >= 0);
  const rule = css.slice(at, css.indexOf('}', at));
  assert.match(rule, /background:\s*transparent/);
  assert.match(rule, /border:\s*0/);
  assert.match(rule, /padding:\s*0/);
  assert.doesNotMatch(rule, /text-decoration|font-size|font-weight|color:/, 'size, weight and colour stay .ing-name\'s');
  assert.match(css, /\.ing-row--line \.ing-name-btn:focus-visible \{ outline: 2px solid/, 'a visible focus ring');
});

test('⚠️ the row hooks still call openEditIngredient — deleting the call fails here', () => {
  assert.match(MAIN, /onEditIngredient\(ing\) \{\s*openEditIngredient\(ing\);\s*\}/);
  assert.match(MAIN, /function openEditIngredient\(ing\) \{/);
  assert.match(codeOf(read('js/orders/ingredients.js')), /onClick: \(\) => hooks\.onEditIngredient\(ing\),/);
});

test('the name button\'s touch target is 44px tall and 24px wide at least, drawn without moving the row', () => {
  const css = read('orders.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const head = css.indexOf('.ing-row--line .ing-name-btn {', css.indexOf('position: relative') - 200);
  const btnAt = css.indexOf('.ing-row--line .ing-name-btn { position: relative');
  assert.ok(btnAt >= 0 && head >= 0);
  const btn = css.slice(btnAt, css.indexOf('}', btnAt));
  assert.match(btn, /position:\s*relative/);
  assert.match(btn, /min-width:\s*24px/);
  const at = css.indexOf('.ing-row--line .ing-name-btn::before {');
  assert.ok(at >= 0, 'an invisible hit area');
  const rule = css.slice(at, css.indexOf('}', at));
  assert.match(rule, /position:\s*absolute/);
  const vertical = Number(/inset:\s*-(\d+(?:\.\d+)?)px 0;/.exec(rule)?.[1]);
  // The name line is 22px; the hit area adds this much above and below.
  assert.ok(22 + 2 * vertical >= 44, `${22 + 2 * vertical}px is under 44`);
  assert.match(rule, /inset:\s*-[\d.]+px 0;/, 'horizontal 0: it never reaches the boxes, the × or the unit menu');
  assert.doesNotMatch(rule, /background|border/, 'invisible');
});

test('focus goes back inside the screen on top, never a hidden row or the page body', () => {
  const fn = MAIN.slice(MAIN.indexOf('function restoreFocusAfterCard'), MAIN.indexOf('function openEditIngredient'));
  assert.match(fn, /const scope = detailView \? detailView\.overlay : document;/);
  assert.match(fn, /scope\.querySelector\(`\[data-ing=/, 'the row is looked up in the screen on top');
  assert.match(fn, /scope\.querySelector\('\.search-row input'\)/);
  assert.match(fn, /scope\.querySelector\('\.orders-icon-btn'\)/);
  assert.match(fn, /wasDeleted \? null/, 'after a delete it does not look for the gone row');
  assert.match(MAIN, /\.finally\(\(\) => \{\s*addingIngredient = false;\s*restoreFocusAfterCard\(ing\.id\);/);
});

// ── Fornitori: the same guard (5th review of PR #254, 2 Oct 2026) ─────────────
// The prices are a second live collection; a card opened before they answer showed empty boxes and an
// untouched Save erased the stored price. Fornitori now reads the price document first, like Orders.
const REGISTRY = codeOf(read('js/orders/registry.js'));
const REGISTRY_MAIN = codeOf(read('js/orders/registry-main.js'));

test('Fornitori reads the price BEFORE it draws an existing ingredient, and a failed read opens nothing', () => {
  const open = REGISTRY.slice(REGISTRY.indexOf('async function openIngredientForm('), REGISTRY.indexOf('function showIngredientForm('));
  assert.ok(open.length > 0, 'the opener exists');
  assert.match(open, /needsPriceRead\(\{ mayPrice: mayWritePrices\(\), pricesLoaded: data\.pricesLoaded\?\.\(\) === true \}\)/);
  // the item is looked up in the live list at open time, never taken from the row's own copy
  assert.match(open, /const current = item \? \(data\.ingredients\(\)\.find\(i => i\.id === item\.id\) \|\| item\) : item;/);
  const readAt = open.indexOf('itemWithPrice(current, await data.readPrice(current.id))');
  const showAt = open.indexOf('showIngredientForm(shown,');
  assert.ok(readAt > 0 && showAt > readAt, 'the price is merged before the card is shown');
  assert.match(open, /catch \(err\) \{[^}]*await alertDialog\(t\('orders\.addIngredientFailed'\)\);\s*return;/, 'a failed read says the card could not open, and opens none');
  // every way into the card goes through the guarded opener
  assert.doesNotMatch(REGISTRY.replace(/function showIngredientForm\(/, ''), /showIngredientForm\((?!shown,)/);
});

test('Fornitori counts the prices as loaded only when the watcher says they are readable', () => {
  assert.match(REGISTRY_MAIN, /watchIngredientPrices\(\(map, readable\) => \{\s*state\.ingredientPrices = map;\s*state\.pricesReadable = readable === true;/);
  assert.match(REGISTRY_MAIN, /pricesLoaded: \(\) => state\.pricesReadable === true,/);
  assert.match(REGISTRY_MAIN, /readPrice: \(id\) => readIngredientPrice\(id\),/);
  assert.match(REGISTRY_MAIN, /pricesReadable: false,/, 'not loaded until the watcher answers');
});
