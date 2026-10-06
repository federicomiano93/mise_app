// An ingredient's «name to show» (shortName), 2 Oct 2026: the ONE rule for which name the app
// displays. `name` stays the supplier's INVOICE name; every SCREEN shows ingredientDisplayName().
// Two names never follow it: what is SENT to a supplier and what is frozen into an order record.
//
// Same model as tests/supplier-label.test.mjs. Three halves: the pure rule and the search, the
// ingredient card EXECUTED (what it hands to saveIngredient), and the call sites read as source —
// a screen left on the invoice name, or a message left on the display name, fails here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

import { ingredientDisplayName, ingredientNameMatches } from '../js/ingredient-name.js';
import {
  ingredientLabel, ingredientDisplayLabel, recordedName, sortByLabel, buildSupplierArchive, unitConflicts,
} from '../js/orders/archive.js';
import { flatRows, matchesQuery, normalizeText } from '../js/orders/ingredient-search.js';
import { itemRows } from '../js/orders/supplier-items.js';
import { supplierSummary } from '../js/orders/order-summary.js';
import { buildOrderMessage, orderedItems } from '../js/orders/order-text.js';
import { linkOptions, suggestLinks } from '../js/catalogue/catalogue-model.js';
import { nameTaken } from '../js/catalogue/ingredient-suggest.js';
import { installDom, walk, type, click } from './helpers/form-dom.mjs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ── The rule ─────────────────────────────────────────────────────────────────

test('the short name wins, trimmed', () => {
  assert.equal(ingredientDisplayName({ name: 'Caputo Farina Tipo 00 Rosso 25kg', shortName: '  Farina 00 ' }), 'Farina 00');
});

test('a blank, whitespace, missing or non-text short name falls back to the name', () => {
  assert.equal(ingredientDisplayName({ name: 'Flour', shortName: '' }), 'Flour');
  assert.equal(ingredientDisplayName({ name: 'Flour', shortName: '   ' }), 'Flour');
  assert.equal(ingredientDisplayName({ name: 'Flour' }), 'Flour');
  assert.equal(ingredientDisplayName({ name: 'Flour', shortName: 42 }), 'Flour');
});

test('never throws on nothing, and answers an empty string', () => {
  for (const bad of [null, undefined, 'text', 7, {}, { name: null }]) {
    assert.doesNotThrow(() => ingredientDisplayName(bad));
  }
  assert.equal(ingredientDisplayName(null), '');
  assert.equal(ingredientDisplayName({}), '');
});

test('ingredientNameMatches: by either name, empty query matches all', () => {
  const ing = { name: 'Caputo Rosso', shortName: 'Farina' };
  assert.ok(ingredientNameMatches(ing, 'farina', normalizeText));
  assert.ok(ingredientNameMatches(ing, 'caputo', normalizeText));
  assert.ok(!ingredientNameMatches(ing, 'burro', normalizeText));
  assert.ok(ingredientNameMatches(ing, '', normalizeText));
  assert.ok(!ingredientNameMatches(undefined, 'x', normalizeText));
});

// ── Orders: screens show it, search finds both, messages keep the invoice name ─

const FLOUR = { id: 'f', name: 'Caputo Rosso 00', shortName: 'Farina', weight: '25kg', supplierId: 'S1', active: true, unit: 'sacco' };
const BUTTER = { id: 'b', name: 'Butter', weight: '1kg', supplierId: 'S1', active: true, unit: '' };
const SUPPLIER = { id: 'S1', name: 'Molino' };

test('the screen label shows the short name; the label of what was sent keeps the invoice name', () => {
  assert.equal(ingredientDisplayLabel(FLOUR), 'Farina 25kg');
  assert.equal(ingredientLabel(FLOUR), 'Caputo Rosso 00 25kg');
  assert.equal(ingredientDisplayLabel(BUTTER), ingredientLabel(BUTTER));
});

test('a record freezes the INVOICE name, and a live ingredient shows through by its display name', () => {
  const record = buildSupplierArchive({
    supplier: SUPPLIER, ingredients: [FLOUR], entries: { f: { qty: 2 } }, date: '2026-10-02', now: new Date('2026-10-02T08:00:00Z'),
  });
  assert.equal(record.names.f, 'Caputo Rosso 00 25kg');
  assert.equal(recordedName('f', { f: FLOUR }, record.names), 'Farina 25kg');
  // the ingredient is gone: the frozen name is what is left
  assert.equal(recordedName('f', {}, record.names), 'Caputo Rosso 00 25kg');
});

test('lists of a supplier\'s products sort and read by the display name', () => {
  const alpha = { id: 'a', name: 'Alpha invoice', shortName: 'Zulu' };
  const mid = { id: 'm', name: 'Mid' };
  assert.deepEqual(sortByLabel([alpha, mid]).map(i => i.id), ['m', 'a'], 'Zulu sorts after Mid, whatever the invoice name');
  assert.equal(itemRows([FLOUR])[0].label, 'Farina 25kg');
});

test('a unit conflict names the line as the screen shows it', () => {
  const record = { quantities: { f: 1 }, units: { f: 'sacco' } };
  const conflicts = unitConflicts(record, { f: { qty: 1, unit: 'busta' } }, [{ ...FLOUR, packUnit: 'busta' }], 'S1');
  for (const c of conflicts) assert.equal(c.name, 'Farina 25kg');
});

test('the All-ingredients list shows the display name and is found by BOTH names', () => {
  const { rows } = flatRows({ ingredients: [FLOUR, BUTTER], suppliers: [SUPPLIER], query: '', only: null });
  const flour = rows.find(r => r.ingredient.id === 'f');
  assert.equal(flour.label, 'Farina 25kg');
  assert.ok(matchesQuery(flour, 'farina'));
  assert.ok(matchesQuery(flour, 'caputo'));
  assert.ok(!matchesQuery(flour, 'burro'));
});

test('⚠️ the message to a supplier keeps the invoice name', () => {
  const text = buildOrderMessage([{ supplierName: 'Molino', items: orderedItems([FLOUR], { f: { qty: 2 } }) }]);
  assert.match(text, /- Caputo Rosso 00: 2/);
  assert.doesNotMatch(text, /Farina/);
  const summary = supplierSummary(SUPPLIER, [FLOUR], { f: { qty: 2 } });
  assert.match(summary.lines[0].label, /Caputo Rosso 00/, 'the lines stay the message\'s own text');
  assert.equal(summary.costLines[0].label, 'Farina 25kg', 'the sheet shows the name to show');
});

test('the source: order-text.js and the frozen names never read the display name', () => {
  assert.doesNotMatch(read('js/orders/order-text.js'), /ingredient-name|ingredientDisplay/);
  assert.match(read('js/orders/archive.js'), /names\[ing\.id\] = ingredientLabel\(ing\);/);
  assert.match(read('js/orders/order-request-model.js'), /names\[ing\.id\] = ingredientLabel\(ing\);/);
  assert.doesNotMatch(read('js/catalogue/recipe-label-model.js'), /ingredient-name|ingredientDisplay/);
});

test('the source: the order rows and Fornitori draw the display name, not the invoice name', () => {
  const rows = read('js/orders/ingredients.js');
  assert.match(rows, /text: ingredientDisplayName\(ing\)/);
  assert.doesNotMatch(rows, /ing\.name/);
  const registry = read('js/orders/registry.js');
  assert.match(registry, /drillRow\(ingredientDisplayName\(item\)/);
  assert.match(registry, /matches\(i\.name\) \|\| matches\(i\.shortName\)/);
});

// ── Catalogue, Food cost, Magazzino ──────────────────────────────────────────

test('the Catalogue picker shows the display name, searches both, and still HANDS BACK the invoice name', () => {
  const ingredients = { f: FLOUR, b: BUTTER };
  const all = linkOptions({ ingredients, query: '' }).ingredients;
  const flour = all.find(o => o.id === 'f');
  assert.equal(flour.displayName, 'Farina');
  assert.equal(flour.name, 'Caputo Rosso 00', 'the name that fills a recipe row stays the invoice name');
  assert.deepEqual(linkOptions({ ingredients, query: 'farina' }).ingredients.map(o => o.id), ['f']);
  assert.deepEqual(linkOptions({ ingredients, query: 'caputo' }).ingredients.map(o => o.id), ['f']);
  const hits = suggestLinks({ ingredients, query: 'far' }).items;
  assert.equal(hits[0].refId, 'f');
  assert.equal(hits[0].displayName, 'Farina');
  assert.equal(hits[0].name, 'Caputo Rosso 00');
  assert.equal(suggestLinks({ ingredients, query: 'cap' }).items[0].refId, 'f');
});

test('a typed name equal to the display name counts as taken', () => {
  assert.ok(nameTaken({ f: FLOUR }, 'farina'));
  assert.ok(nameTaken({ f: FLOUR }, 'Caputo Rosso 00'));
  assert.ok(!nameTaken({ f: FLOUR }, 'Burro'));
});

test('the source: Food cost and Magazzino go through the helper', () => {
  assert.match(read('js/foodcost/foodcost-model.js'), /name: ingredientDisplayName\(ingredient\)/);
  assert.doesNotMatch(read('js/foodcost/foodcost-model.js'), /ingredient\.name/);
  const main = read('js/foodcost/foodcost-main.js');
  assert.match(main, /name: ingredientDisplayName\(i\)\.trim\(\), invoiceName/);
  assert.match(read('js/foodcost/foodcost-editor.js'), /matches\(o\.name\) \|\| matches\(o\.invoiceName\)/);
  for (const file of ['inventory-list', 'inventory-main', 'inventory-usage', 'inventory-value']) {
    assert.match(read(`js/inventory/${file}.js`), /ingredientDisplayName/, file);
  }
  assert.match(read('js/inventory/inventory-list.js'), /fold\(ingredient\.shortName\)/);
});

test('the source: no feature imports the helper from another feature\'s folder', () => {
  for (const file of ['js/orders/archive.js', 'js/inventory/inventory-list.js', 'js/foodcost/foodcost-main.js', 'js/catalogue/catalogue-model.js']) {
    assert.match(read(file), /from '\.\.\/ingredient-name\.js'/, file);
  }
});

// ── The card ─────────────────────────────────────────────────────────────────

const STUB = new URL('./helpers/session-stub.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './firebase.js' && String(context.parentURL).endsWith('/js/ingredient-record-form.js')) {
      return { url: STUB, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
installDom();
globalThis.__miseTestSession = { location: { id: 'loc-test', country: 'IT', language: 'en' } };
const { buildIngredientForm } = await import('../js/ingredient-record-form.js');

function openCard(item, mayPrice = true) {
  const saves = [];
  const root = buildIngredientForm({
    item, suppliers: [{ id: 'S1', name: 'Molino' }], mayPrice, categories: ['Panetteria'], packs: ['busta'],
    panels: { allergens: false, nutrition: false },
    actions: { saveIngredient: async (id, payload) => { saves.push(payload); }, priceHistory: async () => [], packPhotoOn: () => false },
    onDone: () => {},
  });
  const inputs = walk(root).filter(n => n.tagName === 'INPUT' && n.classList.contains('mgmt-input'));
  const save = root.headerSave;
  return { root, saves, name: inputs[0], shortName: inputs[1], async save() { click(save); await new Promise(r => setImmediate(r)); return saves[saves.length - 1]; } };
}

const STORED = { id: 'I1', name: 'Caputo Rosso 00', shortName: 'Farina', supplierId: 'S1', brand: '', category: 'Other', active: true, kind: 'ingredient', unit: 'sacco', weight: '25kg' };

test('the card draws «Name to show» right under «Name», with the note, and caps it at 60', () => {
  const card = openCard(STORED);
  assert.equal(card.shortName.attributes.maxlength, '60');
  assert.equal(card.shortName.value, 'Farina');
  const texts = walk(card.root).map(n => n.textContent);
  assert.ok(texts.some(s => s === 'Name in lists'));
  assert.ok(texts.some(s => /Optional — shorter, for the app’s lists/.test(s)));
  const labels = walk(card.root).filter(n => n.classList.contains('mgmt-field-label')).map(n => n.textContent);
  assert.ok(labels.indexOf('Name in lists') === labels.indexOf('Name in the message') + 1, 'right under the name in the message');
});

test('Save sends a trimmed shortName on the card, and \'\' to clear it (a merge write must be able to clear)', async () => {
  const card = openCard(STORED);
  type(card.shortName, '  Farina 00  ');
  assert.equal((await card.save()).shortName, 'Farina 00');
  const cleared = openCard(STORED);
  type(cleared.shortName, '   ');
  const payload = await cleared.save();
  assert.ok('shortName' in payload);
  assert.equal(payload.shortName, '');
  assert.equal(payload.name, 'Caputo Rosso 00', 'the invoice name is untouched');
});

test('the card of before sends it too', async () => {
  const legacy = { ...STORED, priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg', weight: '2.5kg', unit: 'cartone' };
  const card = openCard(legacy);
  type(card.shortName, 'Farina');
  assert.equal((await card.save()).shortName, 'Farina');
  assert.match(read('js/ingredient-record-form.js'), /legacy-card:begin[\s\S]*shortName: shortName\.value\.trim\(\)[\s\S]*legacy-card:end/);
});

// ── The rules and the price document ─────────────────────────────────────────

test('firestore.rules: ingredients accept shortName (≤60, text), and ingredient-prices do NOT', () => {
  const rules = read('firestore.rules');
  const block = rules.slice(rules.indexOf('match /ingredients/{id} {'), rules.indexOf('match /ingredients/{id} {') + 6000);
  assert.match(block, /'bakery', 'name', 'shortName', 'supplierId'/);
  assert.match(block, /shortName is string\s*&& request\.resource\.data\.shortName\.size\(\) <= 60/);
  const prices = rules.slice(rules.indexOf('match /ingredient-prices/{id} {'));
  assert.doesNotMatch(prices.slice(0, prices.indexOf('hasOnly')+400), /shortName/);
});

// ── A closed month shows what was frozen, never the live short name ──────────

test('⚠️ a closed month shows each product\'s frozen label even when both share a short name', async () => {
  const { productsOfMonth } = await import('../js/inventory/inventory-model.js');
  const live = [
    { id: 'a', name: 'FARINA TIPO 00 W280', shortName: 'Farina 00', weight: '25kg', active: true },
    { id: 'b', name: 'FARINA TIPO 00 W280', shortName: 'Farina 00', weight: '1kg', active: true },
  ];
  const month = {
    closedAt: '2026-09-30', names: { a: 'FARINA TIPO 00 W280 25kg', b: 'FARINA TIPO 00 W280 1kg' },
    opening: {}, purchased: {}, closing: { a: 1, b: 1 },
  };
  const rows = productsOfMonth(month, live);
  assert.deepEqual(rows.map(r => ingredientDisplayName(r)), ['FARINA TIPO 00 W280 25kg', 'FARINA TIPO 00 W280 1kg']);
});

test('the card gives each hint a counter id, never a fixed one', () => {
  const src = read('js/ingredient-record-form.js');
  assert.doesNotMatch(src, /'ingredient-short-name-hint'/);
  const a = openCard(STORED), b = openCard(STORED);
  const hint = card => walk(card.root).find(n => n.classList.contains('notif-note') && n.attributes.id)?.attributes.id;
  assert.notEqual(hint(a), hint(b));
});

test('a supplier screen with no products points to the Ingredients tab, with its own key in both languages', () => {
  assert.match(read('js/orders/registry.js'), /orders\.noIngredientsYetAddPlus/);
  assert.equal(read('js/i18n.js').split("'orders.noIngredientsYetAddPlus':").length - 1, 2);
});

// ── «Nome in fattura»: shown read-only, never saved by the card ──────────────

const WITH_INVOICE_NAME = { ...STORED, invoiceName: 'CAPUTO FARINA 00 ROSSO SACCO KG 25' };

test('the card shows the invoice name as labelled read-only text, not as an input, above the other two names', () => {
  const card = openCard(WITH_INVOICE_NAME);
  const nodes = walk(card.root);
  const label = nodes.find(n => n.classList.contains('mgmt-field-label') && n.textContent === 'Name on the invoice');
  assert.ok(label, 'the label is there');
  const value = nodes.find(n => n.classList.contains('mgmt-readonly'));
  assert.equal(value.textContent, 'CAPUTO FARINA 00 ROSSO SACCO KG 25');
  assert.notEqual(value.tagName, 'INPUT');
  assert.equal(nodes.filter(n => n.tagName === 'INPUT' && n.value === 'CAPUTO FARINA 00 ROSSO SACCO KG 25').length, 0, 'nobody can type into it');
  const group = nodes.find(n => n.attributes && n.attributes['aria-labelledby'] === label.attributes.id);
  assert.ok(group, 'the group is named by its label');
  assert.ok(nodes.some(n => n.attributes && n.attributes.id === group.attributes['aria-describedby'] && /exactly as on the invoice/.test(n.textContent)));
  const labels = nodes.filter(n => n.classList.contains('mgmt-field-label')).map(n => n.textContent);
  assert.ok(labels.indexOf('Name on the invoice') < labels.indexOf('Name in the message'));
});

test('the card has no invoice-name block when the ingredient has none', () => {
  const card = openCard(STORED);
  assert.equal(walk(card.root).some(n => n.classList.contains('mgmt-readonly')), false);
  assert.equal(walk(card.root).some(n => n.textContent === 'Name on the invoice'), false);
});

test('saving never sends invoiceName: the merge write leaves the one the import wrote exactly as it was', async () => {
  const card = openCard(WITH_INVOICE_NAME);
  type(card.name, 'Farina per il fornitore');
  const payload = await card.save();
  assert.equal(payload.name, 'Farina per il fornitore');
  assert.equal('invoiceName' in payload, false);
  const legacy = openCard({ ...WITH_INVOICE_NAME, priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg', weight: '2.5kg', unit: 'cartone' });
  assert.equal('invoiceName' in await legacy.save(), false);
});

test('search finds an ingredient by its invoice name too', () => {
  const ing = { name: 'Farina', shortName: '', invoiceName: 'CAPUTO ROSSO SACCO KG 25' };
  assert.ok(ingredientNameMatches(ing, 'caputo', normalizeText));
  assert.ok(matchesQuery({ label: 'Farina', ingredient: ing, supplierName: 'Molino', supplier: { name: 'Molino' } }, 'caputo rosso'));
});
