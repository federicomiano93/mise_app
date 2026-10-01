// «+ Add ingredient» on a supplier's own order screen (Orders, 30 Sep 2026): the records'
// ingredient card, opened with THIS supplier preset. Nothing here can see a pixel; it pins the
// source facts a later edit could quietly undo (a button hidden behind the list, a second copy
// of the card, a layer that would open UNDER the supplier screen).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const stripJs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const stripCss = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

const DETAIL = stripJs(read('js/orders/supplier-detail.js'));
const MAIN = stripJs(read('js/orders/orders-main.js'));
const CREATE = stripJs(read('js/ingredient-create.js'));
const CSS = stripCss(read('orders.css'));
const I18N = read('js/i18n.js');

test('the button is a round icon button in the HEADER, on the right, built once and never inside the body', () => {
  const header = DETAIL.slice(DETAIL.indexOf("el('header'"), DETAIL.indexOf('body,\n  ]);'));
  const slots = header.split("el('span', { class: 'app-header-slot' }");
  assert.equal(slots.length, 3, 'two slots in the header: Back on the left, the add button on the right');
  assert.match(slots[2], /\[addBtn\]/, 'the right slot holds the add button');
  assert.match(DETAIL, /class: 'app-icon-btn orders-icon-btn'/);
  assert.match(DETAIL, /'aria-label': t\('orders\.addIngredientToListAria', \{ supplier: supplierLabel\(supplier\) \}\)/);
  assert.match(DETAIL, /icon: PLUS_SVG, onClick: \(\) => addIngredient\?\.\(\)/);
  assert.match(DETAIL, /const PLUS_SVG =\s*'<svg[^']*M12 5v14M5 12h14/, 'a plus drawn as an inline SVG');
  const repaint = DETAIL.slice(DETAIL.indexOf('function repaint'));
  assert.doesNotMatch(repaint, /mgmt-add/, 'the dashed body button is gone');
  assert.doesNotMatch(repaint, /appendChild\(addBtn\)/, 'the add button is never put in the scrolling body');
  // Present only when orders-main hands the door in — HIDDEN, not disabled (see the next test).
  assert.match(repaint, /const canAdd = typeof next\.onAddIngredient === 'function';/);
  assert.match(repaint, /addIngredient = canAdd \? \(\) => next\.onAddIngredient\(\) : null;/);
  assert.match(repaint, /addBtn\.hidden = !canAdd;/);
  assert.doesNotMatch(DETAIL, /addBtn\.disabled/);
});

test('Orders opens the shared card from js/ root, over the supplier screen, with this supplier', () => {
  assert.match(MAIN, /import \{ openIngredientCreate \} from '\.\.\/ingredient-create\.js';/);
  assert.doesNotMatch(MAIN, /ingredient-record-form\.js/, 'never the card directly: one opener decides price and panels');
  assert.doesNotMatch(MAIN, /catalogue\//, 'no cross-feature import');
  // ⚠️ The owner's «hide Suppliers & ingredients from the staff» switch closes this door too,
  // with the Catalogue's own question — otherwise Orders would quietly undo the switch.
  assert.match(MAIN, /onAddIngredient: mayAddIngredient\(\) \? \(\) => openAddIngredient\(supplier\.id\) : null,/);
  assert.match(MAIN, /import \{ mayEditRecords \} from '\.\.\/records\.js';/);
  assert.match(MAIN, /function mayAddIngredient\(\) \{\s*const \{ location, canManage \} = currentSession\(\);\s*return mayEditRecords\(location, canManage\);/);
  assert.match(MAIN, /\.catch\(err => \{[\s\S]*?alertDialog\(t\('orders\.addIngredientFailed'\)\)/, 'a card that fails to open says so');
  assert.match(MAIN, /presetSupplierId: supplierId === NO_SUPPLIER_ID \? null : supplierId,/);
  assert.match(MAIN, /layerClass: 'mgmt-overlay',/);
  assert.match(MAIN, /storedCategories: state\.ingredientCategories,/);
  assert.match(MAIN, /if \(addingIngredient\) return;/, 'a double tap opens one card, not two');
  assert.match(MAIN, /\.finally\(\(\) => \{ addingIngredient = false; \}\)/);
});

test('the stored category list is read from config/orders like the records screen does', () => {
  assert.match(MAIN,
    /state\.ingredientCategories = Array\.isArray\(doc\?\.ingredientCategories\) \? doc\.ingredientCategories : null;/);
  assert.match(read('js/orders/registry-main.js'),
    /state\.ingredientCategories = Array\.isArray\(doc\?\.ingredientCategories\) \? doc\.ingredientCategories : null;/);
});

test('the shared opener takes the layer class and the preset, and keeps price with mayWritePrices()', () => {
  assert.match(CREATE, /presetSupplierId = null,/);
  assert.match(CREATE, /layerClass = CATALOGUE_LAYER/);
  assert.match(CREATE, /preset: presetSupplierId,/);
  assert.match(CREATE, /mayPrice: mayWritePrices\(\),/);
  assert.doesNotMatch(CREATE, /from '\.\/(orders|catalogue)\//, 'js/ root imports no feature folder');
  assert.match(CREATE, /orders-header/, 'in Orders the header wears the Orders look');
});

test('the header button wears the shared icon-button look, and the old dashed button CSS is gone', () => {
  // The look (36x36, rim, focus ring) is .app-icon-btn / .orders-icon-btn, the Back button's own.
  assert.doesNotMatch(CSS, /\.supplier-add-ing/, 'no rule left for the retired body button');
  assert.match(CSS, /\.orders-icon-btn/, 'the tablet floor for header icon buttons still applies');
});

test('the empty state points at the button, and every new key exists in EN and IT', () => {
  assert.match(stripJs(read('js/orders/ingredients.js')), /emptyKey = 'orders\.noIngredientsYetAddAbove'/);
  // «with the button above» only when there IS a button above.
  assert.match(DETAIL, /emptyKey: canAdd \? 'orders\.noIngredientsYetAddAbove' : 'orders\.noIngredientsYetAdd'/);
  for (const key of ['orders.addIngredientToList', 'orders.addIngredientToListAria', 'orders.noIngredientsYetAddAbove', 'orders.addIngredientFailed']) {
    const hits = I18N.split(`'${key}':`).length - 1;
    assert.equal(hits, 2, `${key} must be defined once in English and once in Italian`);
  }
  // The spoken name STARTS with the visible words (WCAG 2.5.3): «tap Add ingredient» must find it.
  assert.match(I18N, /'orders\.addIngredientToListAria': 'Add ingredient — \{supplier\}'/);
  assert.match(I18N, /'orders\.addIngredientToListAria': 'Aggiungi ingrediente — \{supplier\}'/);
});

test('an open card keeps the update gate waiting', () => {
  assert.match(read('js/update-gate.js'), /'\.mgmt-form'/);
});
