// foodcost-save-limits.test.mjs — a number the database will refuse stops the save WHILE the
// work is still on screen.
//
// Found by the code review of 14 Sep 2026: a product is saved local-first, so the editor was
// already back on the list when the rules refused a 0 in «persone»; the rollback then removed
// the product somebody had just built. The same shape on the hourly labour cost said «Saved»
// and was refused a moment later, and a 0 there cleared the stored rate in silence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PRODUCT_NUMBER_LIMITS, LABOUR_RATE_MAX, numberAllowed, firstInvalidNumber, labourRateAllowed,
} from '../js/foodcost/product-limits.js';
import { BUSY_SELECTORS } from '../js/update-gate.js';
import { VAT_GUIDE_BY_COUNTRY } from '../js/foodcost/vat-guide.js';
import { _dictionaries } from '../js/i18n.js';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('⚠️⚠️ the limits are the rules\' own numbers, read back out of firestore.rules', () => {
  const rules = read('firestore.rules').replace(/\r\n/g, '\n');
  const block = rules.slice(rules.indexOf('match /products/{id}'), rules.indexOf('match /snapshots/'));
  assert.ok(block.length > 500, 'the products block was found');
  for (const limit of PRODUCT_NUMBER_LIMITS) {
    const f = `request\\.resource\\.data\\.${limit.key}`;
    const m = block.match(new RegExp(`${f} is number\\s*&& ${f} (>=|>) (\\d+)(?:\\s*&& ${f} <= (\\d+))?`));
    assert.ok(m, `firestore.rules range-checks ${limit.key}`);
    assert.equal(m[1] === '>=', limit.minInclusive, `${limit.key}: inclusive minimum`);
    assert.equal(Number(m[2]), limit.min, `${limit.key}: minimum`);
    assert.equal(m[3] === undefined ? null : Number(m[3]), limit.max, `${limit.key}: maximum`);
  }
  const settings = rules.slice(rules.indexOf('match /foodcost-settings/'));
  const rate = settings.match(/labourCostPerHour > 0\s*&& request\.resource\.data\.labourCostPerHour <= (\d+)/);
  assert.ok(rate, 'the hourly rate is range-checked');
  assert.equal(Number(rate[1]), LABOUR_RATE_MAX);
});

test('what the database would refuse, and what it would take', () => {
  assert.equal(firstInvalidNumber({}), null, 'every number is optional');
  assert.equal(firstInvalidNumber(null), null);
  assert.equal(firstInvalidNumber({ labourPeople: 0 }), 'labourPeople', 'the reviewed case: 0 people');
  assert.equal(firstInvalidNumber({ labourMinutes: -5 }), 'labourMinutes');
  assert.equal(firstInvalidNumber({ packSize: 1000001 }), 'packSize');
  assert.equal(firstInvalidNumber({ sellingPrice: Number('x') }), 'sellingPrice', 'NaN is not a price');
  assert.equal(firstInvalidNumber({ vatRate: 0 }), null, '⚠️ a VAT rate of 0 is a REAL answer');
  assert.equal(firstInvalidNumber({ vatRate: 101 }), 'vatRate');
  assert.equal(firstInvalidNumber({ foodCostTarget: 100, packSize: 1000000, labourPeople: 1000 }), null, 'the ceilings themselves are allowed');
  assert.equal(firstInvalidNumber({ piecesPerBatch: 0, labourPeople: 0 }), 'piecesPerBatch', 'the first one, in a fixed order');
  assert.equal(numberAllowed(PRODUCT_NUMBER_LIMITS[0], undefined), true);
  assert.equal(labourRateAllowed(null), true, 'clearing the rate is allowed');
  assert.equal(labourRateAllowed(0), false, '⚠️ a 0 no longer clears the rate in silence');
  assert.equal(labourRateAllowed(LABOUR_RATE_MAX), true);
  assert.equal(labourRateAllowed(LABOUR_RATE_MAX + 0.01), false);
});

test('⚠️⚠️ the editor checks BEFORE it asks «Save these changes?», and knows a box for every limit', () => {
  const editor = codeOf(read('js/foodcost/foodcost-editor.js'));
  const save = editor.slice(editor.indexOf('async function onSave()'), editor.indexOf('async function onDelete()'));
  const check = save.indexOf('let invalid = firstInvalidNumber(working);');
  assert.ok(check > 0, 'onSave asks the limits');
  assert.ok(check < save.indexOf("app.confirm({ title: t('fc.saveProduct')"), 'before the confirmation');
  assert.ok(check < save.indexOf('app.saveProduct('), 'and long before the local-first save');
  assert.match(save, /if \(invalid\) \{[\s\S]*?box\?\.classList\.add\('fc-invalid'\);[\s\S]*?app\.toast\(t\('fc\.checkNumber'[\s\S]*?return;\s*\}/,
    'the box is marked and named, and nothing is saved');
  assert.match(save, /NUMBER_BOXES\[invalid\]\[0\]\.closest\('\[hidden\]'\)\) \{\s*working\[invalid\] = null;/,
    'a value in a box that is not shown is cleared, never asked about');
  const boxes = editor.slice(editor.indexOf('const NUMBER_BOXES = {'), editor.indexOf('async function onSave()'));
  const keys = [...boxes.matchAll(/^\s+(\w+): \[/gm)].map(m => m[1]).sort();
  assert.deepEqual(keys, PRODUCT_NUMBER_LIMITS.map(l => l.key).sort(), 'every limited field has its box');
  assert.match(editor, /oninput: e => \{\s*e\.target\.classList\.remove\('fc-invalid'\);/, 'typing clears the mark');
});

test('⚠️ the hourly cost is checked before its confirmation, and its screen holds back an update', () => {
  const settings = codeOf(read('js/foodcost/foodcost-settings.js'));
  const save = settings.slice(settings.indexOf('async function save()'));
  const check = save.indexOf("if (raw !== '' && !labourRateAllowed(Number(raw))) {");
  assert.ok(check > 0 && check < save.indexOf('const ok = await confirm('), 'checked before «Save these changes?»');
  assert.ok(BUSY_SELECTORS.includes('.fc-settings'), 'an update must not reload the page under a half-typed rate');
  assert.match(settings, /class: 'fc-overlay fc-settings'/);
});

test('the words exist in both languages', () => {
  const { en, it } = _dictionaries();
  for (const key of ['fc.checkNumber', 'fc.settings.rateOutOfRange', 'orders.eg.phone']) {
    assert.ok(en[key] && it[key], `${key} in both languages`);
    assert.notEqual(en[key], it[key], `${key} must not be English on an Italian venue`);
  }
  assert.match(en['fc.checkNumber'], /\{field\}/);
  assert.match(it['fc.checkNumber'], /\{field\}/);
});

test('a VAT group that says nothing takes that rate offers no button to use it', () => {
  const none = Object.values(VAT_GUIDE_BY_COUNTRY).flatMap(g => g.rates).filter(r => r.none);
  assert.ok(none.length >= 1, 'the UK 5% group is marked');
  assert.ok(none.every(r => r.items.length === 1), 'a `none` group carries only the sentence that says so');
  assert.match(codeOf(read('js/foodcost/vat-guide-view.js')), /: group\.none \? null : el\('button', \{/);
});
