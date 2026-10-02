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

test('the price box shares the row: the rate beside «Come si acquista», or the case price alone', () => {
  assert.match(FORM, /const unitField = field\(t\('orders\.howItIsBought'\), unitSelect\);/);
  assert.match(FORM, /const pricePair = el\('div', \{ class: 'mgmt-pair' \}, \[unitField, rateField, casePriceField\]\);/);
  assert.match(FORM, /unitField\.hidden = !typedForm;\s*rateField\.hidden = !typedForm;\s*casePriceField\.hidden = typedForm;/);
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
  // [Peso | Confezione: Singola · Cartone] then, for a carton only, «Contiene [n] × [busta ▾]»
  assert.match(FORM, /mgmt-pair mgmt-pair--data' \}, \[\s*field\(t\('orders\.field\.weight'\), weight\.node\),\s*el\('div', \{ class: 'mgmt-field' \}, \[\s*el\('span', \{ class: 'mgmt-field-label', id: segLabelId, text: t\('orders\.field\.pack'\) \}\),\s*el\('div', \{ class: 'set-seg', role: 'group', 'aria-labelledby': segLabelId \}, \[segSingle, segCarton\]\),\s*\]\),\s*\]\),\s*containsBlock,/);
  assert.doesNotMatch(FORM, /orders\.orderUnit/);
});

test('below 360px the product-data pairs stack, and the weight fits a half cell', () => {
  assert.match(CSS, /@media \(max-width: 359px\) \{ \.mgmt-pair--data \{ grid-template-columns: minmax\(0, 1fr\); \} \}/);
  assert.match(CSS, /\.mgmt-pair--data \.mgmt-weight-row \{ grid-template-columns: minmax\(0, 1fr\) auto; \}/);
});

test('«Confezione» is Singola | Cartone; the inner word is a menu with «+ Nuova…», saved only when the format was touched', () => {
  // the settings kit's segmented control, two pressed-state buttons (not a <label>: a label would press the first)
  assert.match(FORM, /type: 'button', class: 'set-seg-btn', 'aria-pressed': String\(kind === value\), text,/);
  assert.match(FORM, /class: 'set-seg', role: 'group', 'aria-labelledby': segLabelId/);
  assert.match(FORM, /const pack = choiceControl\(\{\s*values: packs, current: openedInner \|\| item\?\.packUnit,/);
  assert.match(FORM, /maxLength: PACK_WORD_MAX, selectLabel: t\('orders\.format\.innerAria'\),/);
  assert.match(FORM, /const refused = \[weight, category, \.\.\.\(kind === 'carton' \? \[pack\] : \[\]\)\]\.find\(control => control\.invalid\(\)\);/, 'an empty «+ Nuova…» blocks the save of a carton');
  assert.match(FORM, /const formatKeys = formatPatch\(before, \{ \.\.\.state, cartonWord \}, \{ force: Boolean\(price && price\.dirty\(\)\) \}\);/);
  assert.match(FORM, /if \(formatKeys\.packUnit\) formatKeys\.packUnit = formatKeys\.packUnit\.slice\(0, PACK_WORD_MAX\);/);
  assert.doesNotMatch(FORM, /\.\.\.\(packUnit \|\| item\?\.packUnit \? \{ packUnit \} : \{\}\)/, 'the old unconditional packUnit is gone');
  assert.match(FORM, /packs = \[\]/);
  assert.match(read('js/orders/registry.js'), /packs: data\.packs\?\.\(item\?\.packUnit\) \|\| \[\],/);
  assert.match(read('js/orders/registry-main.js'), /packs: \(current\) => packChoices\(\{/);
  assert.match(read('js/ingredient-create.js'), /packs: packChoices\(\{ ingredients: known, language \}\),/);
  assert.match(read('firestore.rules'), /'packIngredients', 'packUnit'/);
});

test('the price follows the LIVE weight, count and package word, never a copy of them', () => {
  assert.match(FORM, /const draft = pricePatch\(read\(\), null, weight\);/, 'the live line uses the current weight');
  assert.match(FORM, /pricePatch\(price\.read\(\), new Date\(\)\.toISOString\(\), weight\.read\(\)\)/, 'and so does the save');
  assert.match(FORM, /now: \(\) => \(\{ weight: weight\.read\(\), fmt: \{ \.\.\.formState\(\), kind \} \}\),\s*order: orderNow,/);
  assert.match(FORM, /weight\.onChange\(syncFormat\);\s*pack\.onChange\(syncFormat\);\s*count\.addEventListener\('input', syncFormat\);/);
  assert.match(FORM, /if \(price\) price\.refresh\(\);/, 'every format edit re-draws the price');
  assert.match(FORM, /storedCaseOf\(item\)/, 'reopening reads the case as stored, whatever the weight says now');
});

test('«Cartone» names its contents: switching to it picks the venue\'s default package when none is set', () => {
  assert.match(FORM, /if \(kind === 'carton' && pack\.read\(\) === ''\) \{ pack\.set\(defaultPackFor\(lang\)\); innerAutoSet = true; \}/);
  assert.match(FORM, /if \(kind === 'single' && innerAutoSet\) \{ pack\.set\(''\); innerAutoSet = false; \}/);
  assert.match(FORM, /const lang = outputLanguage\(currentSession\(\)\.location\);\s*const cartonWord = cartonWordFor\(lang\);/);
});

test('the count box is a whole-number box; it is refused, with a jump to it, only when a carton is being WRITTEN', () => {
  assert.match(FORM, /type: 'number', class: 'mgmt-input', min: '1', max: '10000', step: '1', inputmode: 'numeric',/);
  assert.match(FORM, /if \(state\.kind === 'carton' && \(formatIsTouched\(\) \|\| \(price && price\.dirty\(\)\)\) && parseCount\(count\.value\) === null\) \{\s*countRefusal\.show\(\);\s*return;/);
  assert.match(FORM, /count\.addEventListener\('input', countRefusal\.clear\);/);
  const guard = FORM.indexOf('countRefusal.show();');
  assert.ok(guard > 0 && guard < FORM.indexOf('await actions.saveIngredient('), 'before anything is written');
});

test('the new phrases exist once in each language and are read at draw time', () => {
  const src = read('js/i18n.js');
  for (const key of ['orders.field.pack', 'orders.choice.newPack', 'orders.choice.packPlaceholder',
    'orders.choice.packBlank', 'orders.choice.packAria']) {
    assert.equal(src.split(`'${key}':`).length - 1, 2, key);
  }
  assert.doesNotMatch(FORM, /^const [A-Z_]+ = .*t\('orders\./m);
});

test('R3: the supplier screen has two adds, each fixing the kind; the Catalogue still passes ingredient', () => {
  const reg = codeOf(read('js/orders/registry.js'));
  assert.match(reg, /openIngredientForm\(null, supplier\.id, 'ingredient'\)/);
  assert.match(reg, /openIngredientForm\(null, supplier\.id, 'packaging'\)/);
  assert.doesNotMatch(reg, /openIngredientForm\(null, supplier\.id\)/, 'no add without a kind');
  assert.match(codeOf(read('js/ingredient-create.js')), /presetKind: 'ingredient',/);
  const src = read('js/i18n.js');
  for (const key of ['orders.addIngredientShort', 'orders.addPackagingShort']) {
    assert.equal(src.split(`'${key}':`).length - 1, 2, key);
  }
});

test('R4: a weight-priced case with no readable weight blocks the save on the weight box', () => {
  assert.match(FORM, /if \(price && price\.needsWeight\(\)\) \{ weight\.markNeeded\(\); return; \}/);
  assert.match(FORM, /markNeeded: \(\) => \{ refusal\.node\.textContent = t\('orders\.weight\.packNeeded'\); refusal\.show\(\); \}/);
  const src = read('js/i18n.js');
  assert.ok(src.includes("'orders.weight.packNeeded': 'The weight of one item is needed for the case price'"));
  assert.ok(src.includes("'orders.weight.packNeeded': 'Serve il peso di una confezione per il prezzo a cartone'"));
  assert.ok(src.includes("'orders.case.packChanged': 'The format has changed since the last price: saved {old}, with this format {new}. Check the price.'"));
});

test('R5: the «+ Nuovo fornitore…» marker is never saved as a supplier', async () => {
  const { supplierToSave, NEW_SUPPLIER_CHOICE } = await import('../js/record-choices.js');
  assert.equal(supplierToSave(NEW_SUPPLIER_CHOICE, 'SUP_1'), 'SUP_1');
  assert.equal(supplierToSave('SUP_2', 'SUP_1'), 'SUP_2');
  assert.equal(supplierToSave('', 'SUP_1'), '', 'the «no supplier» answer is a real value');
  assert.match(FORM, /supplierId: supplierToSave\(supplierSelect\.value, previous\),/);
});
