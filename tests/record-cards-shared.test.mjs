// record-cards-shared.test.mjs — the ingredient card and the supplier card, shared since
// 13 Sep 2026 between «Fornitori e ingredienti» and a recipe row in the Catalogue.
//
// Federico: «quando scrivo un ingrediente e lo voglio associare ad un fornitore che non ho
// ancora inserito in anagrafica dammi la possibilità di inserirlo direttamente da lì», and
// «se non c'è in anagrafica fammelo inserire direttamente dalla ricerca degli ingredienti» —
// «semplicemente apri una scheda ingrediente come in fornitori ed ingredienti».
//
// What can go wrong without anything on screen looking broken: a create row offered to
// somebody whose save the database refuses, a card that replaces the recipe editor and throws
// its rows away, a new supplier saved but not selected, an ingredient created but the row left
// unlinked, and a second, lighter card drifting away from the real one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mayEditRecords, NO_SUPPLIER_ID } from '../js/records.js';
import { NO_SUPPLIER_ID as ORDERS_NO_SUPPLIER_ID } from '../js/orders/no-supplier.js';
import { nameTaken } from '../js/catalogue/ingredient-suggest.js';
import { _dictionaries } from '../js/i18n.js';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── Who may add a record from the Catalogue ──────────────────────────────────

test('⚠️⚠️ a record may be added only where the records page itself would open', () => {
  assert.equal(mayEditRecords(null, true), false, 'no venue open yet: nothing to judge by');
  assert.equal(mayEditRecords(undefined, false), false);
  assert.equal(mayEditRecords({}, false), true, 'a venue that never mentioned Orders has it, like every section');
  assert.equal(mayEditRecords({ sections: { orders: false } }, true), false,
    'Orders off: the rules refuse the write (canUse(lid, \'orders\')), so the door must not open');
  assert.equal(mayEditRecords({ staffHiddenCards: { suppliers: true } }, false), false,
    'an employee of a venue that hides «Fornitori e ingredienti» is not handed it through the Catalogue');
  assert.equal(mayEditRecords({ staffHiddenCards: { suppliers: true } }, true), true,
    'whoever runs the place sees every card');
  assert.equal(mayEditRecords({ staffHiddenCards: { suppliers: 'yes' } }, false), true, 'only a literal true hides');
});

test('the «no supplier» id is ONE string, whichever feature files the ingredient', () => {
  assert.equal(NO_SUPPLIER_ID, 'no-supplier');
  assert.equal(ORDERS_NO_SUPPLIER_ID, NO_SUPPLIER_ID);
  assert.match(read('js/orders/no-supplier.js'), /import \{ NO_SUPPLIER_ID \} from '\.\.\/records\.js';/);
});

test('the Catalogue asks that rule, of the session, each time', () => {
  assert.match(codeOf(read('js/catalogue/catalogue-main.js')),
    /mayCreateIngredient: \(\) => \{ const s = currentSession\(\); return mayEditRecords\(s\.location, s\.canManage\); \},/);
});

// ── The create row ───────────────────────────────────────────────────────────

test('an ingredient of exactly that name already on file is not offered again', () => {
  const map = { a: { name: 'Burro' }, b: { name: 'Strong flour' } };
  assert.equal(nameTaken(map, ' burro '), true, 'case and the spaces at the ends do not make a new ingredient');
  assert.equal(nameTaken(Object.values(map), 'STRONG FLOUR'), true, 'a list works as well as the map');
  assert.equal(nameTaken(map, 'Burro salato'), false);
  assert.equal(nameTaken(null, 'Burro'), false);
  assert.equal(nameTaken({ x: null, y: {} }, 'Burro'), false);
  // ⚠️ ONLY WHAT A ROW CAN BE LINKED TO (the code review of 14 Sep 2026): a switched-off
  // ingredient or a box of the same name is not offered above, so it must not hide the
  // create row either — that was a dead end with nothing on screen saying why.
  assert.equal(nameTaken({ a: { name: 'Burro', active: false } }, 'Burro'), false);
  assert.equal(nameTaken({ a: { name: 'Burro', kind: 'packaging' } }, 'Burro'), false);
  assert.equal(nameTaken({ a: { name: 'Burro', kind: 'ingredient', active: true } }, 'Burro'), true);
});

test('⚠️⚠️ a recipe row is never linked to packaging, and the Catalogue\'s card offers no «Tipo»', () => {
  const create = codeOf(read('js/catalogue/ingredient-create.js'));
  assert.match(create, /presetKind: 'ingredient',\s*showKind: false,/);
  assert.match(codeOf(read('js/ingredient-record-form.js')), /showKind \? field\(t\('orders\.field\.kind'\), kindSelect\) : null,/);
  assert.match(codeOf(read('js/catalogue/catalogue-editor.js')),
    /if \(!made \|\| !made\.id \|\| made\.kind === 'packaging' \|\| !working\.ingredients\[idx\]\) return;/,
    'and even an item filed as packaging some other way is never linked');
});

test('the supplier card speaks the venue\'s language: weekday ticks and the phone example', () => {
  const ui = codeOf(read('js/record-ui.js'));
  assert.doesNotMatch(ui, /day\.slice\(0, 3\)/, '«Mon» on an Italian card was the stored key cut short');
  assert.match(ui, /t\(`day\.weekdayShort\.\$\{WEEKDAY_INDEX\[day\]\}`\)/);
  assert.match(ui, /WEEKDAY_INDEX = Object\.freeze\(\{ Sunday: 0, Monday: 1,/, 'counted like Date.getDay(), as the dictionary is');
  assert.match(ui, /cb\.dataset\.day = day;/, 'the stored value stays the English key');
  const { en, it } = _dictionaries();
  for (let i = 0; i < 7; i++) assert.ok(en[`day.weekdayShort.${i}`] && it[`day.weekdayShort.${i}`]);
  assert.match(codeOf(read('js/supplier-record-form.js')), /placeholder: t\('orders\.eg\.phone'\)/);
});

test('⚠️ the create row can be the ONLY row — nothing matching is exactly when it is wanted', () => {
  const list = codeOf(read('js/pick-suggest.js'));
  assert.match(list, /const extraRow = extra && onExtra \? extra\(typed\) : null;/);
  assert.match(list, /if \(!items\.length && !extraRow\) \{ close\(\); return; \}/,
    'closing on «no matches» would hide the create row in the one case it exists for');
  assert.match(list, /if \(entry\.extra\) \{ onExtra\(entry\.typed\); return; \}/);
  const suggest = codeOf(read('js/catalogue/ingredient-suggest.js'));
  assert.match(suggest, /if \(!onCreate \|\| !name \|\| !mayCreate\(\)\) return null;/, 'asked at draw time, never captured');
  assert.match(suggest, /return nameTaken\(options\(\)\.ingredients, name\) \? null : \{ label: t\('cat\.createIngredient', \{ name \}\) \};/);
  const picker = codeOf(read('js/catalogue/ingredient-picker.js'));
  assert.match(picker, /if \(!mayCreate \|\| !name \|\| nameTaken\(ingredients, name\)\) return null;/);
  assert.match(picker, /value: \{ create: name \}/);
});

test('⚠️⚠️ creating links the row, from the list and from the chooser alike', () => {
  const editor = codeOf(read('js/catalogue/catalogue-editor.js'));
  assert.match(editor, /mayCreate: \(\) => app\.mayCreateIngredient\(\),\s*onCreate: \(name\) => createAndLink\(idx, name\),/);
  assert.match(editor, /mayCreate: app\.mayCreateIngredient\(\),/);
  assert.match(editor, /if \(chosen && chosen\.create\) \{ createAndLink\(idx, chosen\.create\); return; \}/,
    'a create answer must never reach linkTo() as if it were a link');
  assert.match(editor, /if \(!made \|\| !made\.id \|\| made\.kind === 'packaging' \|\| !working\.ingredients\[idx\]\) return;\s*linkTo\(idx, \{ kind: 'ingredient', refId: made\.id, name: made\.name \}\);/,
    'backing out links nothing; a save links the row through the one place links are written');
});

// ── The card in the Catalogue is THE card ────────────────────────────────────

test('⚠️⚠️ the Catalogue opens the same card, OVER the editor, and backing out saves nothing', () => {
  const create = codeOf(read('js/catalogue/ingredient-create.js'));
  assert.match(create, /import \{ buildIngredientForm \} from '\.\.\/ingredient-record-form\.js';/,
    'the same card, not a lighter copy');
  assert.match(create, /document\.body\.appendChild\(node\);/,
    'a layer on top: swapping the screen would destroy the recipe rows typed so far');
  assert.doesNotMatch(create, /\bswap\(|replaceChildren\(/);
  assert.match(create, /saved = \{ id: newId, name: payload\.name, kind: payload\.kind \};/);
  assert.match(create, /onCancel: \(\) => \{ saved = null; finish\(\); \},/);
  assert.match(create, /packPhotoOn: \(\) => false,/, 'the paid photograph stays where it is switched on');
  assert.doesNotMatch(create, /price-model\.js|recipe-cost-model\.js|formatRate|pricePerKg/,
    'the Catalogue itself still handles no money: the price box is the card\'s own');
});

test('⚠️ «+ Nuovo fornitore» selects the supplier it has just made, in both places', () => {
  const form = codeOf(read('js/ingredient-record-form.js'));
  assert.match(form, /const addSupplierBtn = typeof actions\?\.createSupplier === 'function'/,
    'drawn only where a supplier card can actually be opened');
  assert.match(form, /field\(t\('orders\.field\.supplier'\), supplierSelect\),\s*addSupplierBtn,/, 'right under the supplier menu');
  assert.match(form, /if \(made && made\.id\) selectSupplier\(supplierSelect, made\);/);
  assert.match(codeOf(read('js/orders/registry.js')),
    /return new Promise\(resolve => openSupplierForm\(null, \{ onSaved: resolve, onClosed: \(\) => resolve\(null\) \}\)\);/,
    'the promise settles on Back too, or the button stays disabled for the life of the card');
  assert.match(codeOf(read('js/catalogue/ingredient-create.js')), /createSupplier: \(\) => createSupplier\(layers\),/);
  const card = codeOf(read('js/supplier-record-form.js'));
  assert.match(card, /onDone\?\.\(\{ id: id \|\| item\?\.id \|\| null, name: payload\.name \}\);/);
  assert.match(card, /await reportFailure\('save', payload\.name, err\);\s*return;/, 'a failed save never reports success');
});

test('a new supplier gets its id BEFORE the write, so it can be selected at once', () => {
  const data = codeOf(read('js/record-data.js'));
  assert.match(data, /const ref = id \? doc\(suppliers, id\) : doc\(suppliers\);\s*await setDoc\(ref, withBakery\(data\), \{ merge: true \}\);\s*return ref\.id;/);
  assert.match(codeOf(read('js/orders/firebase-orders.js')),
    /export \{ saveIngredientWithPrice, saveSupplierRecord, mayWritePrices \} from '\.\.\/record-data\.js';/,
    'Orders calls the same writes, not a copy of them');
  assert.match(codeOf(read('js/orders/registry-main.js')), /saveSupplier: \(id, payload\) => saveSupplierRecord\(id, payload\),/);
});

test('the words exist in both languages, and the name is in the sentence', () => {
  const { en, it } = _dictionaries();
  for (const key of ['orders.addSupplierInline', 'cat.createIngredient']) {
    assert.ok(en[key] && it[key], `${key} in both languages`);
    assert.notEqual(en[key], it[key], `${key} must not be English on an Italian venue`);
  }
  assert.match(en['cat.createIngredient'], /\{name\}/);
  assert.match(it['cat.createIngredient'], /\{name\}/);
});
