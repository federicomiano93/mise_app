// foodcost-from-recipes-view.test.mjs — the box and the choice screen for products made from
// the recipe book (28 Oct 2026). Source pins for what would go wrong unseen: the box deciding
// on a stale local copy (a save writes the whole product, so it could overwrite a real one),
// a create that writes before the confirm, and a missing sentence in one language.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const main = read('js/foodcost/foodcost-main.js');
const view = read('js/foodcost/from-recipes-view.js');
const list = read('js/foodcost/foodcost-list.js');
const i18n = read('js/i18n.js');

test('the box counts only for whoever runs the place, on LIVE lists, not narrowed', () => {
  const body = main.match(/function recipesWithoutProductCount\(\) \{([\s\S]*?)\n\}/);
  assert.ok(body, 'recipesWithoutProductCount() is gone');
  for (const needle of ['canManageHere()', 'hasLiveProducts()', 'hasLiveRecipes()', 'listFilter']) {
    assert.ok(body[1].includes(needle), `the box no longer checks ${needle}`);
  }
  assert.match(body[1], /recipesWithoutProducts\(getRecipes\(\), getProducts\(\)\)\.create\.length/);
});

test('the list asks for the count on every paint, and is handed the getter by buildList', () => {
  assert.match(main, /fromBook: recipesWithoutProductCount/);
  assert.match(list, /function paintBook\(\)/);
  assert.match(list, /function paint\(nextProducts, nextTables\) \{\s*paintBook\(\);/);
});

test('nothing is created before the confirm, and a refusal creates nothing', () => {
  const confirmAt = view.indexOf('await confirm(');
  const createAt = view.indexOf('onCreate?.(');
  assert.ok(confirmAt > 0 && createAt > confirmAt, 'onCreate must come after the awaited confirm');
  assert.match(view, /if \(!yes\) return;/);
});

test('the made products are announced only when some were made', () => {
  assert.match(main, /if \(made > 0\) toast\(t\('fc\.fromBook\.done', \{ n: made \}\)\)/);
});

test('the possible matches start unticked and the new ones ticked', () => {
  assert.match(view, /ticked\.set\(item, create\.includes\(item\)\)/);
});

test('every fc.fromBook key exists in English AND Italian', () => {
  const keys = [...new Set([...(view + list + main).matchAll(/t\('(fc\.fromBook\.[A-Za-z]+)'/g)].map(m => m[1]))];
  assert.ok(keys.length >= 15, 'the call sites no longer name the keys');
  const italian = i18n.indexOf("'fc.vatGuide.open': 'Quali");
  assert.ok(italian > 0);
  for (const key of keys) {
    assert.ok(i18n.slice(0, italian).includes(`'${key}'`), `${key} missing in English`);
    assert.ok(i18n.slice(italian).includes(`'${key}'`), `${key} missing in Italian`);
  }
});
