// «Price changes» — how the screen is wired: the button gate, the query shape, no native dialogs, words in
// both languages. The pure parts are in price-changes-model.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _dictionaries } from '../js/i18n.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const SCREEN = codeOf(read('js/orders/price-changes-screen.js'));
const MAIN = codeOf(read('js/orders/registry-main.js'));
const DATA = codeOf(read('js/orders/firebase-orders.js'));
const PAGE = read('suppliers.html');
const SW = read('sw.js');

test('the button sits in the bottom bar, hidden until the session allows it, like the import button', () => {
  const bar = PAGE.match(/<div class="recipe-footer"[\s\S]*?<\/div>/)[0];
  const button = bar.match(/<button[^>]*id="registry-price-changes-btn"[^>]*>[\s\S]*?<\/button>/);
  assert.ok(button);
  assert.match(button[0], /class="recipe-footer-btn"/);
  assert.match(button[0], /\bhidden\b/);
  assert.match(button[0], /data-i18n="priceChanges\.open"/);
  assert.match(button[0], /<svg[^>]*stroke="currentColor"[^>]*stroke-width="2"/);
});

test('⚠️ it is shown and opened under the same gate as the import, and re-evaluated with the session', () => {
  assert.match(MAIN, /priceChangesBtn\.hidden = !\(canManageHere\(\) && mayWritePrices\(\)\)/);
  assert.match(MAIN, /priceChangesBtn\?\.addEventListener\('click', \(\) => \{\s*if \(!\(canManageHere\(\) && mayWritePrices\(\)\)\) return;/);
  assert.match(MAIN, /footerEl\.hidden = !\[\.\.\.footerEl\.children\]\.some/);
});

test('the data layer reads one single-field range, newest-first for the latest', () => {
  assert.match(DATA, /priceChanges: 'price-changes'/);
  const list = DATA.match(/export async function listPriceChanges[\s\S]*?\n\}/)[0];
  assert.match(list, /where\('date', '>=', from\)/);
  assert.match(list, /where\('date', '<=', to\)/);
  assert.match(list, /orderBy\('date'\)/);
  assert.match(list, /pathFor\(COLLECTIONS\.priceChanges\)/);
  const latest = DATA.match(/export async function latestPriceChangeDate[\s\S]*?\n\}/)[0];
  assert.match(latest, /orderBy\('date', 'desc'\)/);
  assert.match(latest, /limit\(1\)/);
});

test('the screen is read-only, never opens a native dialog and keeps its words inside functions', () => {
  assert.doesNotMatch(SCREEN, /\b(confirm|alert|prompt)\(/);
  assert.doesNotMatch(SCREEN, /\b(setDoc|addDoc|updateDoc|deleteDoc|writeBatch)\b/);
  // No t() call at module top level: every one is indented inside a function.
  assert.doesNotMatch(SCREEN, /^(const|let|var) .*\bt\(/m);
  assert.match(SCREEN, /Escape/);
  assert.match(SCREEN, /aria-pressed/);
  assert.match(SCREEN, /'aria-live': 'polite'/);
  assert.match(SCREEN, /formatPricePerUnit/);
  assert.match(SCREEN, /supplierLabel\(/);
  assert.match(SCREEN, /ingredientDisplayName\(/);
});

test('the sign is text, never colour alone', () => {
  assert.match(SCREEN, /pct > 0 \? '\+' : '(\\u2212|−)'/);
});

test('every word exists in both languages', () => {
  const keys = [...new Set([...SCREEN.matchAll(/\bt\('(priceChanges\.[\w.]+)'/g)].map(m => m[1]))];
  const html = [...PAGE.matchAll(/data-i18n="(priceChanges\.[\w.]+)"/g)].map(m => m[1]);
  assert.ok(keys.length > 10);
  const viaHelpers = ['priceChanges.week', 'priceChanges.month', 'priceChanges.previous', 'priceChanges.next',
    'priceChanges.increases', 'priceChanges.decreases', 'priceChanges.groupBy'];
  for (const lang of ['en', 'it']) {
    for (const key of [...keys, ...html, ...viaHelpers]) {
      assert.ok(_dictionaries()[lang][key], `${lang} is missing ${key}`);
    }
  }
});

test('the new files are precached', () => {
  assert.match(SW, /'\.\/js\/orders\/price-changes-model\.js'/);
  assert.match(SW, /'\.\/js\/orders\/price-changes-screen\.js'/);
});
