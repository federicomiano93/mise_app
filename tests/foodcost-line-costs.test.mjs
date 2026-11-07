// foodcost-line-costs.test.mjs — the money under every «Composto da» and packaging line, and the
// «Quali?» list of what has no price.
//
// Federico, 7 Nov 2026: «il costo dell'ingrediente al kg e il costo della quantità selezionata».
// This REVERSES his 13 Sep 2026 rule «nella sezione "composto da" non mostrare il prezzo». The
// failures these tests stop: a line costed one way here and another in the batch total, an
// unknown price shown as 0, a duplicate «no price» sentence, and a list that names nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  componentLineCost, packagingLineCost, batchTotals, packagingPerUnit, unpricedParts,
  unpricedReasonText, productPreview, ingredientLineCost,
} from '../js/foodcost/foodcost-model.js';
import { setLanguage, _dictionaries } from '../js/i18n.js';
import { setCurrency } from '../js/currency.js';
import { lineCostView } from '../js/foodcost/line-cost.js';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const ING = {
  FLOUR: { id: 'FLOUR', name: 'Flour', priceUnit: 'kg', pricePerUnit: 2 },
  SALT: { id: 'SALT', name: 'Salt', priceUnit: 'kg', pricePerUnit: 1.5 },
  EGG: { id: 'EGG', name: 'Egg', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 },
  NIB: { id: 'NIB', name: 'Nib', priceUnit: 'kg', pricePerUnit: 10, unitWeightKg: 0.05 },
  SPRINKLE: { id: 'SPRINKLE', name: 'Sprinkle', priceUnit: 'pcs', pricePerUnit: 0.02 },
  ICING: { id: 'ICING', name: 'Icing', priceUnit: 'kg', pricePerUnit: 4 },
  RIBBON: { id: 'RIBBON', name: 'Ribbon' },
  BOX: { id: 'BOX', name: 'Box', priceUnit: 'pcs', pricePerUnit: 0.12 },
  FILM: { id: 'FILM', name: 'Film', priceUnit: 'kg', pricePerUnit: 3 },
};
const flourRow = grams => ({ label: 'Flour', grams, unit: 'g', kind: 'ingredient', refId: 'FLOUR' });
// 1000 g of flour at 2/kg, 20% lost in the oven → 2.50 a kilo out.
const DOUGH = { id: 'DOUGH', name: 'Dough', lossPct: 20, ingredients: [flourRow(1000)] };
// One linked row and one labelled, unlinked row: priced, but only in part.
const CREAM = { id: 'CREAM', name: 'Cream', lossPct: 0, ingredients: [flourRow(500), { label: 'Water', grams: 100, unit: 'g' }] };
const MYSTERY = { id: 'MYSTERY', name: 'Mystery', lossPct: 0, ingredients: [{ label: 'Something', grams: 500, unit: 'g' }] };
const EMPTY = { id: 'EMPTY', name: 'Empty', lossPct: 0, ingredients: [] };
const FILLING = { id: 'FILLING', name: 'Filling', lossPct: 0, ingredients: [
  flourRow(200), { label: 'Cream', grams: 300, unit: 'g', kind: 'recipe', refId: 'CREAM' },
] };
const CAKE = { id: 'CAKE', name: 'Cake', lossPct: 0, ingredients: [
  flourRow(200), { label: 'Filling', grams: 300, unit: 'g', kind: 'recipe', refId: 'FILLING' },
] };
const LOOP_A = { id: 'LA', name: 'Loop A', lossPct: 0, ingredients: [{ label: 'B', grams: 100, unit: 'g', kind: 'recipe', refId: 'LB' }] };
const LOOP_B = { id: 'LB', name: 'Loop B', lossPct: 0, ingredients: [{ label: 'A', grams: 100, unit: 'g', kind: 'recipe', refId: 'LA' }] };
const TABLES = { ingredients: ING, recipes: { DOUGH, CREAM, MYSTERY, EMPTY, FILLING, CAKE, LA: LOOP_A, LB: LOOP_B } };

const ingLine = (ingredientId, qty, unit) => ({ kind: 'ingredient', ingredientId, qty, unit });
const recLine = (recipeId, qtyKg) => ({ recipeId, qtyKg });
const product = (components, over = {}) => ({
  id: 'P', name: 'P', components, packaging: [], sellingMode: 'piece', piecesPerBatch: 10,
  sellingPrice: 2, vatRate: 0, foodCostTarget: 30, ...over,
});

// ── componentLineCost ─────────────────────────────────────────────────────────

test('a recipe line: its price per kilo of what comes out, and the amount on the line', () => {
  const line = componentLineCost(recLine('DOUGH', 2), TABLES);
  assert.equal(line.rate, 2.5);
  assert.equal(line.rateUnit, 'kg');
  assert.equal(line.cost, 5);
  assert.equal(line.partial, false);
  assert.equal(line.reason, null);
});

test('«no weight loss» lays the oven loss aside, as the batch total does', () => {
  const line = componentLineCost(recLine('DOUGH', 2), TABLES, { noWeightLoss: true });
  assert.equal(line.rate, 2);
  assert.equal(line.cost, 4);
});

test('a partly priced recipe has a rate and says it is partial; an unpriced one has NO rate (null, never 0)', () => {
  const partly = componentLineCost(recLine('CREAM', 1), TABLES);
  assert.equal(partly.rate, 2);
  assert.equal(partly.partial, true);
  const none = componentLineCost(recLine('MYSTERY', 1), TABLES);
  assert.equal(none.rate, null);
  assert.equal(none.cost, null);
  assert.equal(none.reason, 'no-recipe-cost');
  assert.equal(componentLineCost(recLine('GONE', 1), TABLES).reason, 'missing-recipe');
});

test('an ingredient by weight: a price per kilo, in grams or kilos', () => {
  const grams = componentLineCost(ingLine('SALT', 2, 'g'), TABLES);
  assert.deepEqual([grams.rate, grams.rateUnit, grams.cost], [1.5, 'kg', 0.003]);
  const kilos = componentLineCost(ingLine('FLOUR', 3, 'kg'), TABLES);
  assert.deepEqual([kilos.rate, kilos.rateUnit, kilos.cost], [2, 'kg', 6]);
});

test('pieces: priced each → each; priced by the kilo with a piece weight → per kilo', () => {
  const each = componentLineCost(ingLine('SPRINKLE', 10, 'pcs'), TABLES);
  assert.deepEqual([each.rate, each.rateUnit, each.cost], [0.02, 'pcs', 0.2]);
  const eggs = componentLineCost(ingLine('EGG', 4, 'pcs'), TABLES);
  assert.deepEqual([eggs.rate, eggs.rateUnit, eggs.cost], [0.25, 'pcs', 1]);
  const nibs = componentLineCost(ingLine('NIB', 4, 'pcs'), TABLES);
  assert.deepEqual([nibs.rate, nibs.rateUnit, nibs.cost], [10, 'kg', 2]);
  // The same egg counted in grams is a price per kilo (0.25 / 0.06 kg).
  const eggGrams = componentLineCost(ingLine('EGG', 120, 'g'), TABLES);
  assert.equal(eggGrams.rateUnit, 'kg');
  assert.ok(eggGrams.cost > 0);
});

test('a price that exists but cannot be used keeps the rate it has, and no cost', () => {
  const noWeight = componentLineCost(ingLine('SPRINKLE', 5, 'g'), TABLES);
  assert.deepEqual([noWeight.reason, noWeight.rate, noWeight.rateUnit, noWeight.cost], ['no-piece-weight', 0.02, 'pcs', null]);
  const noPiece = componentLineCost(ingLine('ICING', 5, 'pcs'), TABLES);
  assert.deepEqual([noPiece.reason, noPiece.rate, noPiece.rateUnit, noPiece.cost], ['no-piece-price', 4, 'kg', null]);
  const nothing = componentLineCost(ingLine('RIBBON', 5, 'g'), TABLES);
  assert.deepEqual([nothing.reason, nothing.rate, nothing.cost], ['no-ingredient-price', null, null]);
  assert.equal(componentLineCost(ingLine('GONE', 5, 'g'), TABLES).reason, 'missing-ingredient');
});

test('ONE place costs a line: batchTotals rows carry exactly componentLineCost\'s numbers', () => {
  const components = [recLine('DOUGH', 2), recLine('CREAM', 1), recLine('MYSTERY', 1), recLine('GONE', 1),
    ingLine('SALT', 2, 'g'), ingLine('EGG', 4, 'pcs'), ingLine('SPRINKLE', 5, 'g'), ingLine('GONE', 1, 'kg')];
  const batch = batchTotals(product(components), TABLES);
  components.forEach((component, i) => {
    const line = componentLineCost(component, TABLES);
    assert.equal(batch.rows[i].cost, line.cost, `row ${i} cost`);
    assert.equal(batch.rows[i].reason, line.reason, `row ${i} reason`);
  });
  // 5 + 2 (Cream: 1 kg × 2) + 0.003 + 1 — the lines that could be costed, and only those.
  assert.equal(batch.cost, 8.003);
  assert.equal(batch.kg, 3.242);
  assert.equal(batch.partial, true);
  assert.deepEqual(batch.rows[3], { kind: 'recipe', id: 'GONE', name: '', qty: 1, cost: null, reason: 'missing-recipe' });
  assert.deepEqual(batch.rows[0], { kind: 'recipe', id: 'DOUGH', name: 'Dough', qty: 2, cost: 5, reason: null });
  assert.deepEqual(batch.rows[4], { kind: 'ingredient', id: 'SALT', name: 'Salt', qty: 2, unit: 'g', cost: 0.003, reason: null });
});

// ── packagingLineCost ─────────────────────────────────────────────────────────

test('packaging priced each: the rate each and pieces × each', () => {
  const line = packagingLineCost({ qtyPcs: 3 }, ING.BOX);
  assert.deepEqual([line.rate, line.rateUnit, line.cost, line.reason], [0.12, 'pcs', 0.36, null]);
});

test('packaging with NO price is null and a reason, never 0; priced by weight keeps its per-kilo rate', () => {
  const none = packagingLineCost({ qtyPcs: 3 }, ING.RIBBON);
  assert.deepEqual([none.rate, none.rateUnit, none.cost, none.reason], [null, null, null, 'no-price']);
  const byWeight = packagingLineCost({ qtyPcs: 3 }, ING.FILM);
  assert.deepEqual([byWeight.rate, byWeight.rateUnit, byWeight.cost, byWeight.reason], [3, 'kg', null, 'no-piece-price']);
});

test('packagingPerUnit still reports both as «no-piece-price» and counts the priced ones', () => {
  const out = packagingPerUnit(product([], { packaging: [
    { ingredientId: 'BOX', qtyPcs: 2 }, { ingredientId: 'RIBBON', qtyPcs: 1 }, { ingredientId: 'FILM', qtyPcs: 1 },
  ] }), TABLES);
  assert.equal(out.cost, 0.24);
  assert.equal(out.partial, true);
  assert.deepEqual(out.rows.map(r => r.reason), [null, 'no-piece-price', 'no-piece-price']);
});

// ── unpricedParts ─────────────────────────────────────────────────────────────

const parts = (components, over, tables = TABLES) => unpricedParts(product(components, over), tables);

test('product lines that cannot be costed are listed with the reason; gone items are left out (no empty name)', () => {
  assert.deepEqual(parts([ingLine('RIBBON', 1, 'g'), ingLine('SPRINKLE', 5, 'g'), ingLine('ICING', 5, 'pcs'), ingLine('GONE', 1, 'g')]), [
    { name: 'Ribbon', inRecipe: '', reason: 'no-ingredient-price' },
    { name: 'Sprinkle', inRecipe: '', reason: 'no-piece-weight' },
    { name: 'Icing', inRecipe: '', reason: 'no-piece-price' },
  ]);
  assert.deepEqual(parts([ingLine('SALT', 1, 'g'), recLine('DOUGH', 1)]), [], 'nothing missing, nothing listed');
});

test('packaging with no usable price is listed; so is packaging with no way of selling chosen — once', () => {
  const list = parts([recLine('DOUGH', 1)], { packaging: [
    { ingredientId: 'RIBBON', qtyPcs: 1 }, { ingredientId: 'FILM', qtyPcs: 1 }, { ingredientId: 'BOX', qtyPcs: 1 },
  ] });
  assert.deepEqual(list, [
    { name: 'Ribbon', inRecipe: '', reason: 'packaging-no-price' },
    { name: 'Film', inRecipe: '', reason: 'no-piece-price' },
  ]);
  const noMode = parts([recLine('DOUGH', 1)], { sellingMode: null, packaging: [
    { ingredientId: 'BOX', qtyPcs: 1 }, { ingredientId: 'BOX', qtyPcs: 2 },
  ] });
  assert.equal(noMode.length, 1);
  assert.equal(noMode[0].reason, 'packaging-no-mode');
  assert.ok(noMode[0].name.length > 0);
});

test('the rows inside a partly priced recipe are listed with the recipe they are in', () => {
  assert.deepEqual(parts([recLine('CREAM', 1)]), [{ name: 'Water', inRecipe: 'Cream', reason: 'not-linked' }]);
});

test('a sub-recipe is OPENED, priced or not, recursively', () => {
  // Cake → Filling (priced, partly: it holds Cream) → Cream's Water.
  assert.deepEqual(parts([recLine('CAKE', 1)]), [{ name: 'Water', inRecipe: 'Cream', reason: 'not-linked' }]);
});

test('a recipe with no price and nothing labelled to list is listed itself', () => {
  assert.deepEqual(parts([recLine('EMPTY', 1)]), [{ name: 'Empty', inRecipe: '', reason: 'recipe-no-price' }]);
  // …while one with a labelled unpriced row lists the row instead.
  assert.deepEqual(parts([recLine('MYSTERY', 1)]), [{ name: 'Something', inRecipe: 'Mystery', reason: 'not-linked' }]);
});

test('a loop of recipes ends: the row is listed as itself, with the model\'s own reason', () => {
  const list = parts([recLine('LA', 1)]);
  assert.ok(list.length >= 1);
  assert.ok(list.every(item => item.name && item.reason));
});

test('the same unpriced thing is listed once, and the order is the card\'s', () => {
  const list = parts([recLine('CREAM', 1), ingLine('RIBBON', 1, 'g'), recLine('CREAM', 2)]);
  assert.deepEqual(list.map(item => item.name), ['Water', 'Ribbon']);
});

test('pieces and spoons never count as unpriced (they never made the cost partial either)', () => {
  const ODD = { id: 'ODD', name: 'Odd', lossPct: 0, ingredients: [flourRow(100), { label: 'Salt', grams: 2, unit: 'tsp', kind: 'ingredient', refId: 'SALT' }] };
  const tables = { ...TABLES, recipes: { ...TABLES.recipes, ODD } };
  const batch = batchTotals(product([recLine('ODD', 1)]), tables);
  const listed = unpricedParts(product([recLine('ODD', 1)]), tables);
  assert.ok(!listed.some(item => item.reason === 'not-weighable'));
  // The recipe model itself calls a labelled spoon row «partial», so the card's warning stands;
  // the list names only what a person can go and price.
  assert.equal(batch.partial, true);
  assert.deepEqual(listed, []);
});

test('productPreview carries the list; it is empty for no product', () => {
  const preview = productPreview(product([recLine('CREAM', 1)]), TABLES);
  assert.equal(preview.partial, true);
  assert.deepEqual(preview.unpriced, [{ name: 'Water', inRecipe: 'Cream', reason: 'not-linked' }]);
  assert.deepEqual(productPreview(null, TABLES).unpriced, []);
});

test('every unpriced reason becomes words, in both languages', () => {
  for (const lang of ['en', 'it']) {
    setLanguage(lang);
    for (const reason of ['no-ingredient-price', 'packaging-no-price', 'no-piece-weight', 'no-piece-price',
      'packaging-no-mode', 'recipe-no-price', 'not-linked', 'sub-not-costable', 'missing-recipe', 'cycle', 'too-deep']) {
      assert.ok(unpricedReasonText(reason), `${reason} in ${lang}`);
    }
  }
  setLanguage('en');
});

// ── The words under a line ────────────────────────────────────────────────────

function english() { setLanguage('en'); setCurrency('£', { decimal: '.', group: '', symbolAfter: false }); }
function italian() { setLanguage('it'); setCurrency('€', { decimal: ',', group: '.', symbolAfter: true }); }
// The money layout puts a no-break space before «€»; compared as a plain space.
const plainSpaces = r => ({ ...r, text: r.text.replace(/ /g, ' ') });
const view = (entry, kind, opts) => plainSpaces(lineCostView(entry, kind, TABLES, opts));

test('a weighed line with a price: the rate per kilo and this amount; with no quantity only the rate', () => {
  english();
  assert.deepEqual(view(ingLine('FLOUR', 500, 'g'), 'ingredient'), { text: '£2.00/kg · this amount £1.00', noPrice: false });
  assert.equal(view(ingLine('FLOUR', 0, 'g'), 'ingredient').text, '£2.00/kg');
  assert.equal(view(recLine('DOUGH', 2), 'recipe').text, '£2.50/kg · this amount £5.00');
  assert.equal(view(recLine('DOUGH', 2), 'recipe', { noWeightLoss: true }).text, '£2.00/kg · this amount £4.00');
  italian();
  assert.equal(view(ingLine('FLOUR', 500, 'g'), 'ingredient').text, '2,00 €/kg · questa quantità 1,00 €');
});

test('a 2 g pinch of salt does not read 0.00 (exact, like the «Cost per 1 kg» box)', () => {
  english();
  assert.equal(view(ingLine('SALT', 2, 'g'), 'ingredient').text, '£1.50/kg · this amount £0.003');
});

test('a line priced by the piece reads «each», in both languages', () => {
  english();
  assert.equal(view(ingLine('SPRINKLE', 10, 'pcs'), 'ingredient').text, '£0.02 each · this amount £0.20');
  assert.equal(view(ingLine('SPRINKLE', 0, 'pcs'), 'ingredient').text, '£0.02 each');
  italian();
  assert.equal(view(ingLine('SPRINKLE', 10, 'pcs'), 'ingredient').text, '0,02 € al pezzo · questa quantità 0,20 €');
});

test('a partly priced recipe says «not exact yet» after the numbers', () => {
  english();
  assert.equal(view(recLine('CREAM', 1), 'recipe').text, '£2.00/kg · this amount £2.00 · not exact yet');
  italian();
  assert.equal(view(recLine('CREAM', 1), 'recipe').text, '2,00 €/kg · questa quantità 2,00 € · non ancora esatto');
});

test('no price at all reads «— No price» and says so (the old note is then left out) — never 0', () => {
  english();
  for (const [entry, kind] of [[recLine('MYSTERY', 1), 'recipe'], [ingLine('RIBBON', 5, 'g'), 'ingredient'], [{ ingredientId: 'RIBBON', qtyPcs: 2 }, 'packaging']]) {
    assert.deepEqual(view(entry, kind), { text: '— No price', noPrice: true });
  }
  italian();
  assert.equal(view(recLine('MYSTERY', 1), 'recipe').text, '— Nessun prezzo');
});

test('a price that cannot be used shows the known rate only; a gone recipe or item shows nothing', () => {
  english();
  assert.deepEqual(view(ingLine('SPRINKLE', 5, 'g'), 'ingredient'), { text: '£0.02 each', noPrice: false });
  assert.deepEqual(view(ingLine('ICING', 5, 'pcs'), 'ingredient'), { text: '£4.00/kg', noPrice: false });
  assert.deepEqual(view({ ingredientId: 'FILM', qtyPcs: 2 }, 'packaging'), { text: '£3.00/kg', noPrice: false });
  assert.equal(view(recLine('GONE', 1), 'recipe').text, '');
  assert.equal(view(ingLine('GONE', 1, 'g'), 'ingredient').text, '');
  assert.equal(view({ ingredientId: 'GONE', qtyPcs: 1 }, 'packaging').text, '');
});

test('packaging priced each reads the rate and the amount', () => {
  english();
  assert.equal(view({ ingredientId: 'BOX', qtyPcs: 3 }, 'packaging').text, '£0.12 each · this amount £0.36');
  assert.equal(view({ ingredientId: 'BOX', qtyPcs: 0 }, 'packaging').text, '£0.12 each');
});

test('ingredientLineCost is untouched by the new helper', () => {
  assert.deepEqual(ingredientLineCost({ qty: 4, unit: 'pcs' }, ING.EGG), { cost: 1, kg: 0.24, reason: null });
});

// ── The screens (source-level: there is no DOM library here) ─────────────────

const EDITOR = read('js/foodcost/foodcost-editor.js');
const READ = read('js/foodcost/read-sections.js');
const VIEW = read('js/foodcost/preview-view.js');
const CSS = read('foodcost.css');

test('the editor draws the money line above the note in the form, and refreshes it where the note refreshes', () => {
  assert.match(EDITOR, /el\('p', \{ class: 'fc-line-cost'/);
  assert.ok(EDITOR.indexOf("      cost,\n      note,") > -1, 'the cost element sits right above the note');
  const qty = /oninput: e => \{\n\s+entry\[qtyKey\][\s\S]*?paintAnswer\(\);/.exec(EDITOR)[0];
  assert.match(qty, /cost\.textContent = lineCost\(entry, kind\)\.text;/);
  assert.ok(!/repaint\(\)/.test(qty), 'typing a quantity does not rebuild the rows');
  const unit = /onchange: e => \{\n\s+entry\.unit = e\.target\.value;[\s\S]*?paintAnswer\(\);/.exec(EDITOR)[0];
  assert.match(unit, /cost\.textContent = lineCost\(entry, kind\)\.text;/);
  const refresh = /function refreshLive\(\) \{[\s\S]*?\n  \}/.exec(EDITOR)[0];
  assert.match(refresh, /cost\.textContent = lineCost\(entry, kind, tables\)\.text;/, 'a weighing changes a recipe\'s rate');
  assert.ok(!/repaint\(\)/.test(refresh));
  assert.match(EDITOR, /noWeightLoss: working\.noWeightLoss === true/, 'the rate honours «no weight loss»');
});

test('the read view draws the same money line, before the note, and still creates no control', () => {
  assert.match(READ, /cost \? el\('dd', \{ class: 'fc-line-cost fc-read-note', text: cost \}\) : null,\n\s+note \?/);
  assert.match(READ, /lineCost\(entry, kind\)/);
  assert.match(READ, /lineCost\(entry, 'packaging'\)/);
  assert.match(EDITOR, /lineCost: \(entry, kind\) => lineCost\(entry, kind, tables\)\.text/);
  assert.doesNotMatch(READ, /el\('(input|select|textarea)'/);
});

test('the note no longer repeats «no price», and packaging\'s old «each · money» note is gone', () => {
  const note = EDITOR.slice(EDITOR.indexOf('function lineNote('), EDITOR.indexOf('// ── The plain-text view'));
  assert.doesNotMatch(note, /fc\.thisRecipeIsNot|formatRate|formatMoney|fc\.priceEach/);
  assert.match(note, /reason !== 'no-ingredient-price'/);
});

test('the stale «no money under a line» rule is recorded as reversed, with his words', () => {
  for (const file of ['js/foodcost/foodcost-editor.js', 'js/foodcost/per-kg-model.js']) {
    // A sentence in a comment may wrap onto the next line.
    const src = read(file).replace(/\n\s*\/\/\s*/g, ' ');
    assert.match(src, /7 Nov 2026/);
    assert.match(src, /il costo dell'ingrediente al kg e il costo della quantità selezionata/, file);
  }
  assert.doesNotMatch(read('js/foodcost/per-kg-model.js'), /NO MONEY UNDER/);
  assert.doesNotMatch(read('js/foodcost/foodcost-editor.js'), /NO MONEY UNDER A RECIPE LINE. Federico, 13 Sep/);
});

test('«Quali?» is a button with aria-expanded and aria-controls — not a <details> — and closed by default', () => {
  assert.match(VIEW, /el\('button', \{\s*type: 'button', class: 'fc-preview-which-btn', 'aria-controls': whichList\.id/);
  assert.match(VIEW, /whichBtn\.setAttribute\('aria-expanded', String\(whichShown\)\)/);
  assert.match(VIEW, /let whichShown = !!whichOpen;/, 'closed unless the card says it was open');
  assert.match(VIEW, /whichList\.hidden = !whichShown/);
  assert.doesNotMatch(VIEW, /el\('(details|summary)'/);
  assert.match(VIEW, /preview\.partial && Array\.isArray\(preview\.unpriced\)/, 'only under the partial warning');
  assert.match(VIEW, /if \(unpriced\.length\)/, 'and only with something to list');
  assert.match(VIEW, /onWhichToggle\?\.\(whichShown\)/);
  assert.ok(VIEW.indexOf("t('fc.costPartial')") < VIEW.indexOf('    which,'), 'right under the warning');
});

test('the card keeps «Quali?» open through its repaints, like «Dettagli»', () => {
  assert.match(EDITOR, /whichOpen: summaryWhichOpen, onWhichToggle: \(open\) => \{ summaryWhichOpen = open; \}/);
});

test('the money line is styled quietly (no :has, no nesting) and «Quali?» keeps a 44px target', () => {
  assert.match(CSS, /\.fc-line-cost \{[^}]*font-size: \.72rem; color: var\(--fc-text-2\)/);
  assert.match(CSS, /\.fc-line-cost:empty \{ display: none; \}/);
  assert.match(CSS, /\.fc-preview-which-btn \{[^}]*min-height: 44px/);
  assert.doesNotMatch(CSS.slice(CSS.indexOf('.fc-line-cost {')), /:has\(/);
});

test('every new word exists in both languages, and the Italian is Italian', () => {
  const { en, it } = _dictionaries();
  const keys = ['fc.preview.which', 'fc.unpriced.reason', 'fc.unpriced.reasonIn', 'fc.unpriced.noPrice',
    'fc.unpriced.noPieceWeight', 'fc.unpriced.noPiecePrice', 'fc.unpriced.packagingNoMode', 'fc.unpriced.recipeNoPrice',
    'fc.unpriced.packagingName', 'fc.line.perKg', 'fc.line.each', 'fc.line.withAmount', 'fc.line.notExact', 'fc.line.noPrice'];
  // Identical in both on purpose: pure punctuation around the holes, or «/kg».
  const same = new Set(['fc.unpriced.reason', 'fc.line.perKg']);
  for (const key of keys) {
    assert.ok(en[key] && it[key], `${key} in both languages`);
    if (!same.has(key)) assert.notEqual(en[key], it[key], `${key} in Italian must not be the English`);
  }
  assert.match(en['fc.unpriced.reasonIn'], /\{reason\}.*\{name\}/);
  assert.match(it['fc.unpriced.reasonIn'], /\{reason\}.*\{name\}/);
  assert.equal(en['fc.preview.which'], 'Which?');
  assert.equal(it['fc.preview.which'], 'Quali?');
});
