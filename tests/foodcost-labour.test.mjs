// foodcost-labour.test.mjs — what the work on a product costs.
//
// Federico, 13 Sep 2026: «nella sezione food cost dobbiamo aggiungere tempo di produzione
// della ricetta … potremmo anche mettere una sezione dove io metto il costo del lavoro
// orario e l'app mi dice quanto è il costo del lavoro per quella ricetta». Asked how: time
// ON THE PRODUCT (minutes + people), ONE hourly cost for the venue, and — asked who may see
// it — ONLY owners and managers, even where employees are shown the rest of Food cost.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { labourBatchCost, productionCost, costProduct, normalizeProduct } from '../js/foodcost/foodcost-model.js';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const INGREDIENTS = {
  FLOUR: { id: 'FLOUR', priceUnit: 'kg', pricePerUnit: 2 },
  BUTTER: { id: 'BUTTER', priceUnit: 'kg', pricePerUnit: 8 },
};
const DOUGH = { id: 'DOUGH', name: 'Dough', lossPct: 0, ingredients: [
  { label: 'Flour', grams: 800, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
  { label: 'Butter', grams: 200, unit: 'g', kind: 'ingredient', refId: 'BUTTER' },
] };
const withRate = rate => ({ ingredients: INGREDIENTS, recipes: { DOUGH }, labourCostPerHour: rate });
const product = (over = {}) => ({
  id: 'P1', name: 'Cornetto', components: [{ recipeId: 'DOUGH', qtyKg: 10 }], packaging: [],
  sellingMode: 'piece', piecesPerBatch: 100, sellingPrice: 1.2, vatRate: 20, foodCostTarget: 30,
  labourMinutes: 90, labourPeople: 2, ...over,
});

test('the work on a batch: minutes × people × the hourly cost', () => {
  assert.equal(labourBatchCost(product(), withRate(14)), 42, '90 minutes, 2 people, £14 an hour');
  assert.equal(labourBatchCost(product({ labourPeople: null }), withRate(14)), 21, 'nobody said how many: one person');
});

test('⚠️ no time, or no rate, is NO labour cost — never a cost of zero', () => {
  assert.equal(labourBatchCost(product({ labourMinutes: null }), withRate(14)), null);
  assert.equal(labourBatchCost(product(), withRate(null)), null, 'an employee has no rate, so no labour figure at all');
  assert.equal(labourBatchCost(product(), { ingredients: INGREDIENTS, recipes: { DOUGH } }), null);
  assert.equal(productionCost(product(), withRate(null)).labourUnitCost, null);
  assert.equal(costProduct(product(), withRate(null)).labourPct, null);
});

test('one unit\'s labour is divided by the same number as its materials', () => {
  const piece = productionCost(product(), withRate(14));
  assert.equal(piece.unitCost, 0.32);
  assert.equal(piece.labourUnitCost, 0.42, '£42 over 100 pieces');
  assert.equal(piece.totalUnitCost, 0.74);
  const kilo = productionCost(product({ sellingMode: 'weight', piecesPerBatch: null }), withRate(14));
  assert.equal(kilo.labourUnitCost, 4.2, '£42 over 10 kg');
  const pack = productionCost(product({ sellingMode: 'pack', packSize: 500, packUnit: 'g', piecesPerBatch: null }), withRate(14));
  assert.equal(pack.labourUnitCost, 2.1, '£42 over 20 packs of 500 g');
});

test('⚠️⚠️ labour never moves the food cost %: it is shown beside it', () => {
  const without = costProduct(product({ labourMinutes: null }), withRate(14));
  const withIt = costProduct(product(), withRate(14));
  assert.equal(withIt.foodCostPct, without.foodCostPct, 'the food cost is what the ingredients take, and nothing else');
  assert.equal(withIt.status, without.status, 'and so is the traffic light');
  assert.equal(withIt.labourPct, 42, '£0.42 of labour on £1.00 net');
  assert.equal(withIt.totalCostPct, 74, 'everything together');
  assert.equal(withIt.totalUnitCost, 0.74);
});

test('the two fields are kept, and junk is not a time', () => {
  const out = normalizeProduct({ labourMinutes: '45', labourPeople: 'x' });
  assert.equal(out.labourMinutes, 45);
  assert.equal(out.labourPeople, null);
  assert.equal(normalizeProduct({}).labourMinutes, null);
});

test('⚠️⚠️ the rate is watched, and its screen offered, only to whoever runs the place', () => {
  const store = codeOf(read('js/foodcost/foodcost-store.js'));
  assert.match(store, /authReady\.then\(\(\) => \{\s*if \(!canManageHere\(\)\) return;\s*watchFoodcostSettings\(/,
    'an employee never starts the listener');
  assert.match(store, /return \{ recipes, ingredients, labourCostPerHour \};/, 'the rate rides in the tables every figure is worked from');
  assert.doesNotMatch(store, /writeJson\([^)]*labour/i, 'the rate is never mirrored to localStorage on a shared phone');
  const save = store.slice(store.indexOf('export function saveProduct('), store.indexOf('const prev = products.find'));
  assert.match(save, /labourMinutes: product\.labourMinutes \?\? null,/);
  assert.match(save, /labourPeople: product\.labourPeople \?\? null,/);

  const main = codeOf(read('js/foodcost/foodcost-main.js'));
  assert.match(main, /settingsBtn\.hidden = !canManageHere\(\);/, 'the Settings button carries its own permission');
  assert.match(main, /footerBar\.hidden = view !== 'list' \|\| settingsBtn\.hidden;/, 'and the bar is shown only while a button in it is');

  const rules = read('firestore.rules');
  const block = rules.slice(rules.indexOf('match /foodcost-settings/{settingsId}'), rules.indexOf('match /products/{id}'));
  assert.match(block, /allow read: if settingsId == 'main' && canManage\(lid, 'foodcost'\);/, 'read by whoever runs the place, never cardAccess');
  assert.match(block, /allow create, update: if settingsId == 'main'\s*&& canManage\(lid, 'foodcost'\)/);
  assert.match(block, /allow delete: if false;/);
  const products = rules.slice(rules.indexOf('match /products/{id}'), rules.indexOf('match /snapshots/{snapshotId}'));
  assert.match(products, /'labourMinutes', 'labourPeople'/, 'the time is a known key on a product');
});

test('the product screen draws labour money only when there is a rate to draw it from', () => {
  const editor = codeOf(read('js/foodcost/foodcost-editor.js'));
  assert.match(editor, /if \(cost\.labourUnitCost !== null\)/, 'the production cost box adds labour only with a figure');
  assert.match(editor, /if \(result\.labourPct !== null\)/, 'and so does the answer');
  assert.match(editor, /labourNote\.textContent = /, 'with no rate, a manager is told where to set it');
});

test('the bottom bar is the page ground and its button the raised surface, like every other bar', () => {
  const css = read('foodcost.css');
  assert.match(css, /--fc-ground:\s*var\(--bg\)/);
  const bar = css.slice(css.indexOf('\n.fc-footer {'), css.indexOf('}', css.indexOf('\n.fc-footer {')));
  const btn = css.slice(css.indexOf('\n.fc-footer-btn {'), css.indexOf('}', css.indexOf('\n.fc-footer-btn {')));
  assert.match(bar, /background:\s*var\(--fc-ground\)/);
  assert.match(btn, /background:\s*var\(--fc-surface\)/);
  assert.match(read('foodcost.html'), /<div class="fc-footer" id="fcFooter" hidden>/, 'hidden until the session says a button belongs in it');
});
