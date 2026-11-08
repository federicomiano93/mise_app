// Food cost, two decimals — what the screens actually DRAW (fake DOM, like
// foodcost-read-sections.test.mjs). The list row and the margin history are not exported
// pieces, so they are pinned by the exact expression in their source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this._text = null;
    this.className = '';
    this.classList = { add() {}, contains() { return false; } };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text !== null ? this._text : this.children.map((c) => c.textContent).join(''); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener() {}
}
class FakeText extends FakeNode {
  constructor(text) { super('#text'); this._text = String(text); }
}
globalThis.Node = FakeNode;
globalThis.document = {
  createElement: (tag) => new FakeNode(tag),
  createTextNode: (text) => new FakeText(text),
};

const NB = ' ';
const { setLanguage } = await import('../js/i18n.js');
const { setCurrency } = await import('../js/currency.js');
const { previewPanel } = await import('../js/foodcost/preview-view.js');
const rs = await import('../js/foodcost/read-sections.js');

const walk = (node, out = []) => { out.push(node); node.children.forEach((c) => walk(c, out)); return out; };
const allText = (node) => walk(node).map((n) => n._text).filter((s) => s !== null);

function italian() {
  setLanguage('it');
  setCurrency('€', { decimal: ',', group: '.', symbolAfter: true });
}

const preview = {
  unit: 'piece', sellingPrice: 3, materialsUnitCost: 0.004, packagingUnitCost: null, hasPackaging: false,
  labourUnitCost: null, totalUnitCost: 0.004, foodCostPct: 32.5, targetPct: 30, status: 'amber',
  margin: -1.5, idealGross: 0.01, idealNet: 0.009, partial: false, unpriced: [], missing: [],
};

test('the preview panel draws two decimals, and a tiny cost reads «< 0,01 €»', () => {
  italian();
  const texts = allText(previewPanel(preview)).join(' | ');
  assert.match(texts, /32,50% · obiettivo 30,00%/);
  assert.ok(texts.includes(`<${NB}0,01${NB}€`), texts);
  assert.ok(texts.includes(`-1,50${NB}€`), 'a negative margin is real');
  assert.ok(texts.includes(`3,00${NB}€`));
  assert.doesNotMatch(texts, /(^| )0,00/);
});

test('the preview panel without a target says «32,50% · nessun obiettivo»', () => {
  italian();
  const texts = allText(previewPanel({ ...preview, targetPct: null, idealGross: null, idealNet: null })).join(' | ');
  assert.match(texts, /32,50% · nessun obiettivo/);
});

test('the weighing sentence is drawn as «12,00%» (params formatted where drawn)', async () => {
  italian();
  const recipes = { r1: { name: 'Dough', rawGrams: 1000, cookedGrams: 880, lossPct: 12 } };
  const view = rs.readWeighings({ noWeightLoss: false, recipes, recipeIds: ['r1'] });
  const texts = allText(view).join(' | ');
  assert.match(texts, /12,00%/);
  const { weighingParams } = await import('../js/foodcost/fc-number.js');
  assert.deepEqual(weighingParams({ pct: '12' }), { pct: '12,00' });
  assert.deepEqual(weighingParams({ max: '99' }), { max: '99,00' });
  assert.deepEqual(weighingParams({}), {});
});

test('the list row and the margin history print their percentage through fcNumber (source pin)', () => {
  const src = (f) => readFileSync(new URL(`../js/foodcost/${f}`, import.meta.url), 'utf8');
  assert.ok(src('foodcost-list.js').includes('`${fcNumber(result.foodCostPct)}%`'));
  assert.ok(src('foodcost-list.js').includes('fcMoney(result.unitCost)'));
  assert.ok(src('foodcost-list.js').includes('fcMoney(result.margin)'));
  assert.ok(src('foodcost-main.js').includes('`${fcNumber(entry.foodCostPct)}%`'));
  assert.ok(src('foodcost-main.js').includes('fcNumber(entry.vatRate)'));
});
