// The ingredient card's layout and packages (29 Sep 2026): the price box always in the right
// cell, no «Tipo» menu, «+ Nuovo fornitore…» as the last option of the supplier menu, the short
// fields two to a row, and «Confezione» (packUnit). No DOM is available under node --test, so
// this pins the wiring a pure test cannot reach; the arithmetic is in pack-case.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const FORM = codeOf(read('js/ingredient-record-form.js'));
const CSS = read('orders.css');

test('the price box is the right cell of the same row in every mode', () => {
  assert.match(FORM, /const pricePair = el\('div', \{ class: 'mgmt-pair' \}, \[\s*field\(t\('orders\.howItIsBought'\), unitSelect\),\s*rateField,\s*casePriceField,\s*\]\);/);
  assert.match(FORM, /rateField\.hidden = inCase;\s*casePriceField\.hidden = !inCase;/);
  assert.doesNotMatch(FORM, /casePriceLabel/, 'the full-width case price field is gone');
});

test('the case price label is the short one', () => {
  const src = read('js/i18n.js');
  assert.ok(src.includes("'orders.case.price': 'Case price ({currency})'"));
  assert.ok(src.includes("'orders.case.price': 'Prezzo cartone ({currency})'"));
});

test('there is no «Tipo» menu: the kind is fixed and still sent', () => {
  assert.doesNotMatch(FORM, /kindSelect|showKind/);
  assert.match(FORM, /kind: startKind,/);
  const src = read('js/i18n.js');
  assert.doesNotMatch(src, /'orders\.field\.kind'|'orders\.kind\./);
});

test('the supplier menu ends with «+ Nuovo fornitore…» and the old link button is gone', () => {
  assert.doesNotMatch(FORM, /mgmt-add-inline|addSupplierBtn/);
  assert.doesNotMatch(CSS, /mgmt-add-inline/);
  assert.match(FORM, /const NEW_SUPPLIER = /);
  assert.match(FORM, /const newRow = rows\.find\(o => o\.value === NEW_SUPPLIER\) \|\| null;/, 'a created supplier goes BEFORE the option');
  assert.match(FORM, /select\.insertBefore\(option, after \|\| newRow\);/);
  assert.match(FORM, /if \(made && made\.id\) selectSupplier\(supplierSelect, made\);\s*else supplierSelect\.value = previous;/);
  const src = read('js/i18n.js');
  assert.ok(src.includes("'orders.addSupplierInline': '+ New supplier…'"));
  assert.ok(src.includes("'orders.addSupplierInline': '+ Nuovo fornitore…'"));
});

test('the short fields sit two to a row, name and supplier stay whole', () => {
  assert.match(FORM, /field\(t\('orders\.field\.name'\), name\),\s*field\(t\('orders\.field\.supplier'\), supplierSelect\),/);
  assert.match(FORM, /mgmt-pair mgmt-pair--data' \}, \[\s*field\(t\('orders\.field\.brand'\), brand\),\s*field\(t\('orders\.field\.category'\), category\.node\),\s*\]\)/);
  assert.match(FORM, /mgmt-pair mgmt-pair--data' \}, \[\s*field\(t\('orders\.field\.weight'\), weight\.node\),\s*field\(t\('orders\.field\.pack'\), pack\.node\),\s*\]\)/);
  assert.match(FORM, /mgmt-pair mgmt-pair--data' \}, \[\s*field\(t\('orders\.orderUnit'\), unit\.node\),\s*\]\)/);
});

test('below 360px the product-data pairs stack, and the weight fits a half cell', () => {
  assert.match(CSS, /@media \(max-width: 359px\) \{ \.mgmt-pair--data \{ grid-template-columns: minmax\(0, 1fr\); \} \}/);
  assert.match(CSS, /\.mgmt-pair--data \.mgmt-weight-row \{ grid-template-columns: minmax\(0, 1fr\) auto; \}/);
});

test('«Confezione» is a menu with «+ Nuova…», saved as packUnit only when there is something to say', () => {
  assert.match(FORM, /const pack = choiceControl\(\{\s*values: packs, current: item\?\.packUnit,/);
  assert.match(FORM, /maxLength: PACK_WORD_MAX,/);
  assert.match(FORM, /const refused = \[weight, category, pack, unit\]\.find\(control => control\.invalid\(\)\);/, 'an empty «+ Nuova…» blocks the save');
  assert.match(FORM, /\.\.\.\(packUnit \|\| item\?\.packUnit \? \{ packUnit \} : \{\}\),/);
  assert.match(FORM, /packs = \[\]/);
  assert.match(read('js/orders/registry.js'), /packs: data\.packs\?\.\(item\?\.packUnit\) \|\| \[\],/);
  assert.match(read('js/orders/registry-main.js'), /packs: \(current\) => packChoices\(\{/);
  assert.match(read('js/catalogue/ingredient-create.js'), /packs: packChoices\(\{ ingredients: known, language \}\),/);
  assert.match(read('firestore.rules'), /'packIngredients', 'packUnit'/);
});

test('«busta da 2,5 kg» reads the LIVE weight and package word, and gives no size box', () => {
  assert.match(FORM, /function syncPackOption\(\) \{/);
  assert.match(FORM, /const \{ weight, packUnit \} = now\(\);/);
  assert.match(FORM, /if \(!w && !selected\) \{ packOption\.remove\(\); return; \}/, 'only while readable, unless chosen');
  assert.match(FORM, /caseSizeBox\.hidden = itemsArePieces \|\| sizeFromWeight;/);
  assert.match(FORM, /pricePatch\(read\(\), null, now\(\)\.weight\)/, 'the live line uses the current weight');
  assert.match(FORM, /pricePatch\(price\.read\(\), new Date\(\)\.toISOString\(\), weight\.read\(\)\)/, 'and so does the save');
  assert.match(FORM, /packUnit: pack\.read\(\) \}\)\) : null;/, 'the VAT line hears the package word');
  assert.match(FORM, /pack\.onChange\(price\.refresh\);/);
  assert.match(FORM, /storedCaseOf\(item, item\)/, 'reopening reads the case against the stored weight');
});

test('the new phrases exist once in each language and are read at draw time', () => {
  const src = read('js/i18n.js');
  for (const key of ['orders.field.pack', 'orders.choice.newPack', 'orders.choice.packPlaceholder',
    'orders.choice.packBlank', 'orders.choice.packAria', 'orders.case.packOf', 'orders.case.packWord']) {
    assert.equal(src.split(`'${key}':`).length - 1, 2, key);
  }
  assert.doesNotMatch(FORM, /^const [A-Z_]+ = .*t\('orders\./m);
});
