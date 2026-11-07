// The read sections RUN against a small fake DOM, and the visible text is asserted — the
// source-pattern tests in foodcost-read-mode.test.mjs cannot see what a figure reads like.
import { test } from 'node:test';
import assert from 'node:assert/strict';

class ClassList {
  constructor() { this.set = new Set(); }
  add(...names) { names.forEach((n) => n && this.set.add(n)); }
  contains(name) { return this.set.has(name); }
}
class FakeNode {
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
  set className(value) { this.classList = new ClassList(); this.classList.add(...String(value).split(/\s+/)); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text !== null ? this._text : this.children.map((c) => c.textContent).join(''); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener() {}
}
class FakeText extends FakeNode {
  constructor(text) { super('#text'); this._text = String(text); }
}
globalThis.document = {
  createElement: (tag) => new FakeNode(tag),
  createTextNode: (text) => new FakeText(text),
};

const { setLanguage, t } = await import('../js/i18n.js');
const { setCurrency } = await import('../js/currency.js');
const rs = await import('../js/foodcost/read-sections.js');

const walk = (node, out = []) => { out.push(node); node.children.forEach((c) => walk(c, out)); return out; };
const text = (node) => node.textContent;
const withClass = (node, name) => walk(node).filter((n) => n.classList.contains(name));
const values = (root) => withClass(root, 'fc-read-row').map((r) => r.children[1].textContent);
const valueOf = (root, key) => {
  const row = withClass(root, 'fc-read-row').find((r) => r.children[0].textContent === t(key));
  assert.ok(row, `row «${key}» exists`);
  return row.children[1].textContent;
};

function italian() {
  setLanguage('it');
  setCurrency('€', { decimal: ',', group: '.', symbolAfter: true });
}
function english() {
  setLanguage('en');
  setCurrency('£', { decimal: '.', group: '', symbolAfter: false });
}

test('VAT 0 reads «0%», VAT not set reads «Non inserito»; the target uses the decimal comma', () => {
  italian();
  const zero = rs.readPrice({ vatRate: 0, target: 32.5, price: 6.5 });
  assert.equal(valueOf(zero, 'fc.vatRate'), '0%');
  assert.equal(valueOf(zero, 'fc.foodCostTarget'), '32,5%');
  const unset = rs.readPrice({ vatRate: null, target: null, price: null });
  assert.deepEqual(values(unset), ['Non inserito', 'Non inserito', 'Non inserito']);
  const free = rs.readPrice({ vatRate: 10, target: 30, price: 0 });
  assert.equal(values(free)[2], 'Non inserito', 'a price of 0 is «Not set», never a zero price');
});

test('a recipe line is as exact as the form: 0.0125 kg, 0.5 kg, 1.25 kg, 10 kg', () => {
  italian();
  assert.equal(rs.recipeQtyText(0.0125), '12,5 g');
  assert.equal(rs.recipeQtyText(0.5), '500 g');
  assert.equal(rs.recipeQtyText(1.25), '1,25 kg');
  assert.equal(rs.recipeQtyText(10), '10 kg');
  assert.equal(rs.recipeQtyText(0.999999), '1 kg', 'never «1000 g»');
  english();
  assert.equal(rs.recipeQtyText(0.0125), '12.5 g');
  const comps = [0.0125, 0.5, 1.25].map((qtyKg) => ({ kind: 'recipe', qtyKg }));
  const view = rs.readMadeOf({ components: comps, lineName: () => ({ text: 'Dough', missing: false }), lineNote: () => '' });
  assert.deepEqual(values(view), ['12.5 g', '500 g', '1.25 kg']);
});

test('ingredient pieces read «3 pz» in Italian and «3 pcs» in English; packaging lines too', () => {
  const comps = [{ kind: 'ingredient', qty: 3, unit: 'pcs' }, { kind: 'ingredient', qty: 2.5, unit: 'kg' }];
  const args = { components: comps, lineName: () => ({ text: 'Egg', missing: false }), lineNote: () => '' };
  italian();
  assert.deepEqual(values(rs.readMadeOf(args)), ['3 pz', '2,5 kg']);
  const pack = rs.readPackaging({ packaging: [{ qtyPcs: 1 }, { qtyPcs: 4 }], lineName: () => ({ text: 'Box', missing: false }), lineNote: () => '' });
  assert.deepEqual(values(pack), ['1 pz', '4 pz']);
  english();
  assert.equal(values(rs.readMadeOf(args))[0], '3 pcs');
});

test('an empty «Composto da» and an empty packaging say «Nothing yet»', () => {
  italian();
  const none = rs.readMadeOf({ components: [], lineName: () => ({}), lineNote: () => '' });
  assert.equal(text(none), t('fc.read.nothingYet'));
  assert.equal(text(rs.readPackaging({ packaging: [], lineName: () => ({}), lineNote: () => '' })), t('fc.read.nothingYet'));
});

test('the weighings: a cooked weight above the raw one shows the red warning; no weight loss shows its line', () => {
  italian();
  const recipes = { r1: { name: 'Dough', rawGrams: 1000, cookedGrams: 1200 } };
  const view = rs.readWeighings({ noWeightLoss: false, recipes, recipeIds: ['r1'] });
  const warn = withClass(view, 'fc-weigh-warn');
  assert.equal(warn.length, 1);
  assert.equal(warn[0].textContent, t('fc.lossCookedHeavier'));
  assert.equal(withClass(view, 'fc-read-invalid').length, 1, 'the cooked value is marked red');
  const fine = rs.readWeighings({ noWeightLoss: false, recipes: { r1: { name: 'Dough', rawGrams: 1000, cookedGrams: 900, lossPct: 10 } }, recipeIds: ['r1'] });
  assert.equal(withClass(fine, 'fc-weigh-warn').length, 0);
  assert.equal(withClass(fine, 'fc-read-invalid').length, 0);
  const finished = rs.readWeighings({ noWeightLoss: true, recipes, recipeIds: ['r1'] });
  assert.equal(text(finished), t('fc.noWeightLoss'));
});

test('labour and pack figures go through the venue layout', () => {
  italian();
  const labour = rs.readLabour({ minutes: 7.5, people: 2, note: '' });
  assert.deepEqual(values(labour), ['7,5', '2']);
  const product = rs.readProduct({ name: 'Pane', sellingMode: 'pack', packSize: 0.5, packUnit: 'kg', piecesPerBatch: null });
  assert.equal(valueOf(product, 'fc.packHolds'), '0,5 kg');
});
