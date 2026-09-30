// A supplier's ingredients as ROWS under one sticky Order / Stock header (Federico,
// 29 Sep 2026): «un ingrediente uno sotto l'altro con una linea leggera di divisione»,
// «costruiscilo come il riepilogo». Nothing here can see a pixel; it pins the source
// facts a later edit could quietly undo — above all that no rule reaches the Calculator's
// `.ing-row` (the collision that cost v181).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const stripCss = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = stripCss(read('orders.css'));
const INGREDIENTS = read('js/orders/ingredients.js');

const buildRowSource = INGREDIENTS.slice(INGREDIENTS.indexOf('export function buildRow('));
const headerSource = INGREDIENTS.slice(
  INGREDIENTS.indexOf('export function buildIngredientHeader'),
  INGREDIENTS.indexOf('export function buildRow'),
);

// The declarations of EVERY rule whose selector list contains `selector`, joined.
function rule(selector) {
  const found = [];
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map((x) => x.trim()).includes(selector)) found.push(m[2]);
  }
  assert.ok(found.length, `orders.css has no rule for ${selector}`);
  return found.join('\n');
}

test('buildRow makes a one-line row with a class of its own', () => {
  assert.match(buildRowSource, /class:\s*'ing-row ing-row--line'/);
  assert.match(buildRowSource, /dataset:\s*\{\s*ing:\s*ing\.id\s*\}/, 'the [data-ing] hook other screens query must stay');
});

test('a row no longer carries its own ORDER / STOCK words', () => {
  assert.doesNotMatch(buildRowSource, /field-label/);
  assert.doesNotMatch(buildRowSource, /orders\.field\.(order|stock)/);
  // Each input keeps the aria-label that names the ingredient.
  assert.match(buildRowSource, /orders\.stockOnHandFor/);
  assert.match(buildRowSource, /orders\.qtyToOrderFor/);
  // hide-stock still finds the Stock column by the same class.
  assert.match(buildRowSource, /class: 'ing-col stock-field'/);
});

test('the header names the two columns once, from the existing keys, read inside the function', () => {
  assert.match(headerSource, /t\('orders\.field\.order'\)/);
  assert.match(headerSource, /t\('orders\.field\.stock'\)/);
  assert.match(headerSource, /ing-head-stock/);
});

test('both lists start with the header', () => {
  assert.match(INGREDIENTS, /class:\s*'ingredient-list'\s*\},\s*\[progress,\s*buildIngredientHeader\(\)\]/);
  const flat = read('js/orders/ingredient-list.js');
  assert.match(flat, /import\s*\{[^}]*buildIngredientHeader[^}]*\}\s*from '\.\/ingredients\.js'/);
  assert.match(flat, /listEl\.appendChild\(buildIngredientHeader\(\)\)/);
});

test('the History editor keeps its own rows exactly as they were', () => {
  const hist = read('js/orders/history-edit.js');
  assert.match(hist, /class:\s*'ing-row'\s*\}/);
  assert.doesNotMatch(hist, /ing-row--line/);
  assert.match(hist, /field-label/);
  assert.match(CSS, /\.hist-edit-list \.ing-row \{ display: block; \}/);
});

test('EVERY new row rule is scoped through .ing-row--line or a list — never a bare .ing-row', () => {
  const offenders = [];
  for (const m of CSS.matchAll(/([^{}]+)\{/g)) {
    for (const raw of m[1].split(',')) {
      const sel = raw.trim();
      if (!/ing-row--line|\.ing-head|\.ing-col/.test(sel)) continue;
      const scoped = /^\.ing-row--line\s|\.ingredient-list|\.ing-flat-list|^body\.hide-stock|^\.ing-head/.test(sel);
      if (!scoped) offenders.push(sel);
    }
  }
  assert.deepEqual(offenders, []);
  // And the Calculator's class is never given a rule by these lists.
  assert.doesNotMatch(CSS, /\.ingredient-list \.ing-row\s*[,{]/);
  assert.doesNotMatch(CSS, /#suppliers-list \.ing-row\s*[,{]/);
});

test('the rows are a three-column grid, one column of ingredients, a line between them', () => {
  const r = rule('.ingredient-list .ing-row--line');
  assert.match(r, /display:\s*grid/);
  assert.match(r, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+var\(--ing-box-w\)\s+var\(--ing-box-w\)/);
  assert.match(r, /border-bottom:\s*1px solid var\(--border\)/);
  assert.match(rule('.ingredient-list .ing-row--line:last-child'), /border-bottom:\s*none/);
  const head = rule('.ing-head');
  assert.match(head, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+var\(--ing-box-w\)\s+var\(--ing-box-w\)/,
    'the header must use the SAME columns as the rows');
});

test('both lists are cards like the order summary', () => {
  for (const sel of ['.ingredient-list', '.ing-flat-list']) {
    const r = rule(sel);
    assert.match(r, /background:\s*var\(--surface\)/);
    assert.match(r, /border:\s*1px solid var\(--border\)/);
    assert.match(r, /padding:\s*4px 14px 8px/);
  }
});

test('the header is sticky: at the top of the supplier screen, under the tabs in the flat list', () => {
  assert.match(rule('.ing-head'), /position:\s*sticky/);
  assert.match(rule('.ing-head'), /background:\s*var\(--surface\)/);
  // -14px = .supplier-detail-body's padding-top: top 0 left a 14px band of rows above it.
  assert.match(rule('.ingredient-list > .ing-head'), /top:\s*-14px/);
  assert.match(rule('.supplier-detail-body'), /padding:\s*14px /);
  assert.match(rule('.ing-flat-list > .ing-head'), /top:\s*var\(--order-head-h,\s*0px\)/);
  const main = read('js/orders/orders-main.js');
  assert.match(main, /trackStickyHead\(document\.querySelector\('\.order-box-head'\)\)/);
  assert.match(read('js/orders/sticky-offset.js'), /--order-head-h/);
  assert.match(read('js/orders/sticky-offset.js'), /ResizeObserver/);
});

test('with Stock hidden the header and the rows lose the column, and the header its word', () => {
  assert.match(rule('body.hide-stock .ing-row--line'), /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+var\(--ing-box-w\)/);
  assert.match(rule('body.hide-stock .ing-head'), /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+var\(--ing-box-w\)/);
  assert.match(rule('body.hide-stock .ing-head-stock'), /display:\s*none/);
  assert.match(rule('body.hide-stock .stock-field'), /display:\s*none/);
});

test('boxes: 56px on a phone (the name keeps 102px at 296), 88px and the tap floor on a tablet; no 2-column grid', () => {
  assert.match(CSS, /--ing-box-w:\s*56px/);
  assert.match(CSS, /--ing-box-w:\s*88px/);
  assert.match(rule('.ing-row--line input.ing-qty'), /width:\s*var\(--ing-box-w\)/);
  assert.match(rule('.ing-row--line input.ing-qty'), /min-height:\s*var\(--ing-box-h\)/);
  assert.doesNotMatch(CSS, /grid-template-columns:\s*1fr\s+1fr\s*;\s*column-gap:\s*32px/);
});

test('the unit is a small caption under the Order box', () => {
  const r = rule('.ing-row--line .ing-order-unit');
  assert.match(r, /font-size:\s*11px/);
  assert.match(r, /var\(--text-3\)/);
});

test('the swap button beside the search is at least 44px wide', () => {
  assert.match(rule('body[data-section="orders"] .order-tools-btn'), /min-width:\s*44px/);
});
