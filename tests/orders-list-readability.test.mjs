// Orders list readability (Federico, 29 Sep 2026): bigger Order / Incoming tabs, ONE quiet
// swap button beside the search box at EVERY size (the phone's two pills are hidden), and
// the supplier names first. Nothing here can see a pixel; it pins the source facts a later
// edit could quietly undo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const stripCss = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = stripCss(read('orders.css'));

// The declaration block of the first rule whose selector is exactly `selector`.
function block(selector) {
  const i = CSS.indexOf(selector + ' {');
  assert.ok(i >= 0, `orders.css has no rule for ${selector}`);
  return CSS.slice(i, CSS.indexOf('}', i));
}

// Everything outside any @media block, so a rule found here applies at every size.
function outsideMedia(css) {
  let out = '';
  let depth = 0;
  let i = 0;
  while (i < css.length) {
    if (depth === 0 && css.startsWith('@media', i)) {
      const open = css.indexOf('{', i);
      let d = 1;
      i = open + 1;
      while (i < css.length && d > 0) { if (css[i] === '{') d += 1; else if (css[i] === '}') d -= 1; i += 1; }
      continue;
    }
    out += css[i];
    i += 1;
  }
  return out;
}
const EVERYWHERE = outsideMedia(CSS);

test('the swap button is never hidden outside the tablet query, and is a flex row at every size', () => {
  assert.ok(!/\.order-tools\s*\{\s*display:\s*none/.test(EVERYWHERE), '.order-tools must not be display:none on a phone');
  assert.match(EVERYWHERE, /\.order-tools\s*\{\s*display:\s*flex/);
  assert.match(EVERYWHERE, /\.search-row\s*\{\s*display:\s*flex;[^}]*align-items:\s*stretch/);
});

test('the two-pill switch is hidden at every size but stays in the page for refreshViewSwitch()', () => {
  assert.match(EVERYWHERE, /#order-view-switch\s*\{\s*display:\s*none/);
  assert.ok(read('orders.html').includes('id="order-view-switch"'));
});

test('the swap button is quiet and matches the search box', () => {
  const rule = block('body[data-section="orders"] .order-tools-btn');
  assert.match(rule, /background:\s*transparent/);
  assert.match(rule, /border:\s*1px solid var\(--border\)/);
  assert.match(rule, /color:\s*var\(--text-2\)/);
  assert.match(rule, /font-size:\s*14px/);
  assert.match(rule, /font-weight:\s*500/);
  assert.match(rule, /border-radius:\s*14px/);
  assert.match(rule, /padding-inline:\s*12px/);
  assert.match(rule, /gap:\s*6px/);
  // the search box's own radius, so the two read as one row
  assert.match(block('.mgmt-search-input'), /border-radius:\s*14px/);
  assert.match(CSS, /\.order-tools-btn:focus-visible/);
});

test('the label goes, the icon stays, below 360px', () => {
  assert.match(CSS, /@media \(max-width: 359px\)\s*\{\s*body\[data-section="orders"\] \.order-tools-label\s*\{\s*display:\s*none/);
});

test('the Order / Incoming tabs are 18px at every size, bold when active', () => {
  const tab = block('body[data-section="orders"] .order-box-head .tab-bar .tab');
  assert.match(tab, /font-size:\s*18px/);
  assert.match(tab, /font-weight:\s*600/);
  assert.match(tab, /display:\s*inline-flex/);
  assert.match(tab, /align-items:\s*center/);
  assert.match(EVERYWHERE, /\.order-box-head \.tab-bar \.tab/);
  assert.match(block('body[data-section="orders"] .order-box-head .tab-bar .tab.active'), /font-weight:\s*700/);
});

test('supplier names are 18px bold on the phone and in the tablet split', () => {
  assert.match(block('.supplier-name'), /font-size:\s*18px;\s*font-weight:\s*700/);
  const split = block('body[data-section="orders"][data-orders-tab="order"][data-orders-view="suppliers"] .supplier-name');
  assert.match(split, /font-size:\s*18px/);
  assert.match(split, /font-weight:\s*700/);
});

test('the All / Ordering filter is quieter but keeps a 44px tap target', () => {
  const rule = block('body[data-section="orders"] .ing-filter .view-switch-btn');
  assert.match(rule, /font-size:\s*14px/);
  assert.match(rule, /min-height:\s*44px/);
  assert.match(block('body[data-section="orders"] .ing-filter .view-switch-btn:not(.active)'), /color:\s*var\(--text-2\)/);
});

test('the swap button is mounted by both list views with no tablet gate in JS', () => {
  const main = read('js/orders/orders-main.js');
  const fn = main.slice(main.indexOf('function buildOrderTools()'));
  assert.ok(!/isTabletNow|TABLET_QUERY|matchMedia/.test(fn.slice(0, fn.search(/^\}/m))));
  assert.ok((main.match(/searchExtras:\s*buildOrderTools\(\)/g) || []).length >= 2);
  assert.match(read('js/orders/suppliers.js'), /ctx\.searchExtras/);
  assert.match(read('js/orders/ingredient-list.js'), /ctx\.searchExtras/);
});
