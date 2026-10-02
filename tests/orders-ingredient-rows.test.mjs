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
  // …and under the pinned search bar too, so the offset is the two measured heights added.
  assert.match(rule('.ing-flat-list > .ing-head'),
    /top:\s*calc\(var\(--order-head-h,\s*0px\)\s*\+\s*var\(--order-search-h,\s*0px\)\)/);
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

test('each row has a clear-quantity button in the name column, named per ingredient', () => {
  assert.match(buildRowSource, /class:\s*'ing-qty-clear'/);
  assert.match(buildRowSource, /type:\s*'button'/);
  // Name AND weight, so «Flour 1kg» and «Flour 25kg» are two different buttons to a
  // screen reader, and a nameless product never reads «undefined».
  assert.match(buildRowSource, /t\('orders\.clearQtyFor',\s*\{\s*name:\s*ingredientLabel\(ing\)\s*\|\|\s*t\('orders\.unnamedProduct'\)\s*\}\)/);
  // It is the LAST child of .ing-main: it must come before the Order column starts.
  assert.ok(buildRowSource.indexOf("'ing-qty-clear'") > buildRowSource.indexOf("class: 'ing-main'"));
  assert.ok(buildRowSource.indexOf("'ing-qty-clear'") < buildRowSource.indexOf("class: 'ing-col'"));
});

test('the clear button zeroes the quantity, keeps stock, and focuses only from the keyboard', () => {
  assert.match(buildRowSource, /setQty\(0\)/);
  assert.match(buildRowSource, /event\.detail === 0\)\s*qtyInput\.focus\(\)/);
  assert.doesNotMatch(buildRowSource, /confirmDialog/);
  // KEEPS STOCK: the handler touches the quantity only — the stock counted on the shelf
  // is a different fact and survives the order being cleared.
  const button = buildRowSource.slice(buildRowSource.indexOf("'ing-qty-clear'"));
  const handler = button.slice(button.indexOf('onClick'), button.indexOf("class: 'ing-col'"));
  assert.doesNotMatch(handler, /stock/i);
  // A cleared line goes back to the card's unit, and the menu is repainted to show it.
  assert.match(handler, /\.unit = ''/);
  assert.match(handler, /paintUnitSelect\(row, ing, cleared\)/);
  assert.match(buildRowSource, /function setQty\(value, fromInput\) \{\s*const qty = wholeNumber\(value\);\s*entryFor\(entries, ing\.id\)\.qty = qty;/);
});

test('ing-row--filled follows the quantity: at build, in setQty and when another phone syncs', () => {
  assert.match(INGREDIENTS, /export function markFilled\(row, qty\)/);
  assert.match(INGREDIENTS, /toggle\('ing-row--filled'/);
  assert.match(buildRowSource, /markFilled\(row, qty\)/, 'setQty');
  assert.match(buildRowSource, /markFilled\(row, entry\.qty\)/, 'build time');
  const main = read('js/orders/orders-main.js');
  const sync = main.slice(main.indexOf('function syncInputsFromState'));
  assert.match(sync.slice(0, sync.indexOf('refreshAllSuppliers')), /markFilled\(row, entry\.qty\)/);
  assert.match(main, /import \{ markFilled, paintUnitSelect \} from '\.\/ingredients\.js'/);
});

test('the clear button is a 44x44 target, hidden until the row is filled, and the name makes room', () => {
  const base = rule('.ing-row--line .ing-qty-clear');
  assert.match(base, /width:\s*44px/);
  assert.match(base, /height:\s*44px/);
  assert.match(base, /display:\s*none/);
  assert.match(rule('.ing-row--line .ing-main'), /position:\s*relative/);
  assert.match(rule('.ingredient-list .ing-row--line.ing-row--filled .ing-qty-clear'), /display:\s*flex/);
  assert.match(rule('.ing-flat-list .ing-row--line.ing-row--filled .ing-qty-clear'), /display:\s*flex/);
  assert.match(rule('.ingredient-list .ing-row--line.ing-row--filled .ing-main'), /padding-right:\s*44px/);
  assert.match(rule('.ing-row--line .ing-qty-clear:focus-visible'), /outline:/);
});

test('the clear-quantity label exists in English and Italian', () => {
  const i18n = read('js/i18n.js');
  assert.equal(i18n.match(/'orders\.clearQtyFor':/g).length, 2);
  assert.match(i18n, /'orders\.clearQtyFor': 'Clear the quantity of \{name\}'/);
  assert.match(i18n, /'orders\.clearQtyFor': 'Azzera la quantità di \{name\}'/);
});

test('the swap button beside the search is at least 44px wide', () => {
  assert.match(rule('body[data-section="orders"] .order-tools-btn'), /min-width:\s*44px/);
});

// ── The unit choice on a row (30 Sep 2026) ───────────────────────────────────
test('a row offers a unit menu only when the card offers a choice, in place of the caption', () => {
  assert.match(buildRowSource, /unitChoices\(ing,\s*entry\.unit\)/);
  assert.match(buildRowSource, /choices\.length >= 2/);
  assert.match(buildRowSource, /class:\s*'ing-unit-select'/);
  assert.match(buildRowSource, /!unitSelect && ing\.unit \? el\('span', \{ class: 'ing-order-unit'/);
  assert.match(buildRowSource, /t\('orders\.unitToOrderFor',\s*\{\s*name:\s*ingredientLabel\(ing\)\s*\|\|\s*t\('orders\.unnamedProduct'\)\s*\}\)/);
});

test('changing the unit stores only a non-default unit, autosaves, and keeps the quantity', () => {
  const change = buildRowSource.slice(buildRowSource.indexOf("unitSelect.addEventListener('change'"));
  const handler = change.slice(0, change.indexOf('});') + 3);
  assert.match(handler, /\.unit = storedUnitFor\(unitSelect\.value,\s*ing\)/);
  assert.match(handler, /hooks\.afterChange\(supplier\.id\)/);
  assert.match(handler, /updateHint\(\)/);
  assert.doesNotMatch(handler, /\.qty\s*=/, 'the quantity is not touched');
});

test('the draft arriving from another phone repaints the unit menu, skipping a focused one', () => {
  assert.match(INGREDIENTS, /export function paintUnitSelect\(row, ing, entry\)/);
  assert.match(INGREDIENTS, /select === document\.activeElement/);
  const main = read('js/orders/orders-main.js');
  assert.match(main, /import \{ markFilled, paintUnitSelect \} from '\.\/ingredients\.js'/);
  const sync = main.slice(main.indexOf('function syncInputsFromState'));
  assert.match(sync.slice(0, sync.indexOf('refreshAllSuppliers')), /paintUnitSelect\(row, ingById\[row\.dataset\.ing\], entry\)/);
});

test('the unit menu is a second grid line over Order + Stock, a 44px target, scoped to the row class', () => {
  const r = rule('.ing-row--line .ing-unit-select');
  assert.match(r, /grid-column:\s*2 \/ -1/);
  assert.match(r, /grid-row:\s*2/);
  assert.match(r, /min-height:\s*var\(--ing-box-h\)/);
  // iOS Safari zooms the page on focusing a control under 16px.
  assert.match(r, /font-size:\s*(1[6-9]|[2-9]\d)px/);
  assert.match(rule('.ing-row--line .ing-unit-select:focus-visible'), /outline:/);
  assert.match(rule('.ingredient-list .ing-row--choice .ing-main'), /grid-row:\s*1 \/ span 2/);
});

test('the unit menu label exists in English and Italian', () => {
  const i18n = read('js/i18n.js');
  assert.match(i18n, /'orders\.unitToOrderFor': 'Unit to order for \{name\}'/);
  assert.match(i18n, /'orders\.unitToOrderFor': 'Unità d’ordine per \{name\}'/);
});

test('⚠️ a line in another unit than the card shows no suggestion and never auto-fills', () => {
  const hint = buildRowSource.slice(buildRowSource.indexOf('function updateHint'));
  const body = hint.slice(0, hint.indexOf('stockInput.addEventListener'));
  // The guard comes BEFORE the suggestion is asked for, and answers «inactive» — which is
  // what the stock handler reads to decide whether to fill the quantity in.
  const guard = body.indexOf('isDefaultUnit(entryFor(entries, ing.id), ing)');
  assert.ok(guard > -1 && guard < body.indexOf('suggest(ing.id'));
  assert.match(body.slice(guard, body.indexOf('suggest(ing.id')), /return \{ active: false \}/);
  assert.match(buildRowSource, /if \(result\.active\) setQty\(result\.suggestion\)/);
  // Switching unit re-runs the hint, so going back to the default brings it back.
  assert.match(buildRowSource, /unitSelect\.addEventListener\('change'[\s\S]*?updateHint\(\)/);
});

test('the suggestion engine is asked with the card, so its history is one unit', () => {
  const main = read('js/orders/orders-main.js');
  assert.match(main, /computeSuggestion\(id, stock, state\.history, ing\)/);
});
