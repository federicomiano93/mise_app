// Magazzino on a tablet: the summary column on the left, the count rows in two columns on
// the right (inventory.css, js/inventory/inventory-list.js). P15.
//
// No jsdom in this project, so the wiring is pinned at source level. What a later edit could
// quietly break: the two-column layout leaking to the phone, the Tab order stopping following
// the reading order (a CSS `order`, a column-flow grid), a detail screen going 1180px wide,
// the toast stretching, Food cost widening with it (it shares data-section), a feature
// importing from another, and the count logic being touched by a layout change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// Splits a stylesheet into the text INSIDE the tablet query and the text outside it.
function halves(css) {
  const src = strip(css);
  let inside = '';
  let outside = '';
  let last = 0;
  const re = /@media[^{]*min-width:\s*900px[^{]*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') depth -= 1;
      i += 1;
    }
    outside += src.slice(last, m.index);
    inside += src.slice(re.lastIndex, i - 1);
    last = i;
    re.lastIndex = i;
  }
  outside += src.slice(last);
  return { inside, outside };
}

const { inside, outside } = halves(read('inventory.css'));

test('Magazzino widens on ITS OWN data-card, never on the section Food cost shares', () => {
  const tokens = strip(read('tokens.css'));
  const block = tokens.slice(tokens.indexOf('@media (min-width: 900px)'));
  assert.match(block, /body\[data-card="inventory"\]/);
  assert.doesNotMatch(block, /body\[data-section="foodcost"\]/);
  assert.match(read('inventory.html'), /<body data-section="foodcost" data-card="inventory">/);
});

test('the two-column list exists only under the tablet query', () => {
  assert.match(inside, /\.inv-view--list\s*\{[^}]*display:\s*grid/);
  assert.match(inside, /grid-template-columns:\s*320px minmax\(0, 1fr\)/);
  assert.match(inside, /\.inv-list\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(inside, /\.inv-list > \.inv-group[^{]*\{[^}]*grid-column:\s*1 \/ -1/);
  assert.doesNotMatch(outside, /display:\s*grid/, 'the phone must not get a grid');
  assert.doesNotMatch(outside, /grid-template-columns/);
  assert.doesNotMatch(outside, /overflow-y:\s*auto[^}]*\}\s*\.inv-list/);
});

test('the phone half of the side block is the view\'s own column and gap', () => {
  assert.match(outside, /\.inv-side\s*\{\s*display:\s*flex;\s*flex-direction:\s*column;\s*gap:\s*12px;\s*\}/);
  assert.match(outside, /\.inv-view\s*\{[^}]*gap:\s*12px/);
});

test('Tab order equals reading order: no CSS reordering, no column-flow grid', () => {
  const css = strip(read('inventory.css'));
  assert.doesNotMatch(css, /(^|[;{\s])order\s*:/, 'a CSS order would part the Tab order from what is seen');
  assert.doesNotMatch(css, /grid-auto-flow/, 'grid auto-flow must stay the default (by row)');
  assert.doesNotMatch(css, /column-count|(^|[;{\s])columns\s*:/, 'CSS columns flow DOWN then across, against the Tab order');
  assert.doesNotMatch(css, /flex-direction:\s*(row|column)-reverse/);
});

test('the DOM is the side block first, then the rows; the boxes are built as before', () => {
  const src = read('js/inventory/inventory-list.js');
  const from = src.indexOf("class: 'inv-view inv-view--list'");
  assert.ok(from >= 0, 'the list root lost its modifier class');
  const at = (needle) => { const i = src.indexOf(needle, from); assert.ok(i >= 0, `${needle} is gone`); return i; };
  assert.ok(at("el('div', { class: 'inv-side' }") < at('summary,') );
  assert.ok(at('summary,') < at('actions,'));
  assert.ok(at('actions,') < at("el('div', { class: 'inv-tools' }"));
  const rowsAt = src.slice(from).search(/\]\),\r?\n\s*rows,\r?\n\s*\]\);/);
  assert.ok(rowsAt >= 0, 'the rows must follow the side block as the second child of the view');
  assert.ok(at("el('div', { class: 'inv-tools' }") < from + rowsAt);
  // A layout change must not touch how a count is read: the same handler, the same input.
  assert.match(src, /onchange: \(e\) => onCount\(ingredient\.id, e\.target\.value\)/);
  assert.match(src, /inputmode: 'decimal'/);
});

test('the number boxes are kitchen size on the tablet only', () => {
  assert.match(inside, /\.inv-count\s*\{[^}]*height:\s*var\(--tap-min\)[^}]*font-size:\s*var\(--qty-font\)/);
  assert.match(outside, /\.inv-count\s*\{[^}]*height:\s*44px/);
});

test('screens that are not the list keep a 620px column, and the toast keeps its own', () => {
  assert.match(inside, /\.inv-view:not\(\.inv-view--list\)\s*\{\s*max-width:\s*620px/);
  assert.match(inside, /body\[data-card="inventory"\] \.inv-toast\s*\{[^}]*--app-max-width:\s*620px[^}]*--app-gutter:\s*max\(0px, calc\(\(100% - var\(--app-max-width\)\) \/ 2\)\)/);
  // The detail, the cost screen and the employee's notice all use .inv-view without the modifier.
  assert.match(read('js/inventory/inventory-detail.js'), /class: 'inv-view'/);
  assert.match(read('js/inventory/inventory-usage.js'), /class: 'inv-view'/);
  assert.match(read('js/inventory/inventory-main.js'), /wrap\.className = 'inv-view'/);
});

test('the inventory feature never imports from another feature', () => {
  for (const f of ['inventory-list', 'inventory-main', 'inventory-detail']) {
    assert.doesNotMatch(read(`js/inventory/${f}.js`), /from\s+['"]\.\.\/(orders|catalogue|foodcost|pastries)\//, `${f}.js reaches into another feature`);
  }
});
