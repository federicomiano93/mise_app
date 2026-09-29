// One empty state, one way to add, one arrow (P15).
//
// ⚠️ WHY THIS IS PINNED. Every one of these was a per-screen invention that drifted: a
// dashed «+ Add …» row on two screens and a round «+» in the header of a third, a `›`
// typed as text on six and an SVG chevron on the rest, and five different looks for
// «there is nothing here yet». No behaviour test can see any of it, so the shape is
// pinned on the source instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const stripJsComments = js => js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(new URL(dir, root), { withFileTypes: true })) {
    if (entry.name === 'vendor') continue;
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) out.push(...jsFiles(`${path}/`));
    else if (entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

test('no «›» is typed as a drill arrow anywhere in js/ — the SVG chevron is the one arrow', () => {
  const offenders = [];
  for (const file of jsFiles('js/')) {
    const code = stripJsComments(read(file));
    // A drill arrow is the glyph handed to a node as its text, or as a child string.
    if (/text:\s*'›'|,\s*'›'\s*\)|'›'\s*\]/.test(code)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});

test('every place that drew a «›» now draws the chevron path M9 18l6-6-6-6', () => {
  const files = [
    'js/catalogue/catalogue-list.js', 'js/catalogue/catalogue-detail.js',
    'js/catalogue/allergen-sheet.js', 'js/catalogue/catalogue-editor.js',
    'js/ingredient-record-form.js',
  ];
  for (const file of files) {
    assert.match(read(file), /M9 18l6-6-6-6/, `${file} must carry the chevron SVG`);
  }
  assert.match(read('js/calculator-client-orders.js'), /icon\('chevronRight'/);
});

test('the Food cost list has no dashed «Add product» row; the header carries a hidden-by-default #fcAdd', () => {
  const html = read('foodcost.html');
  const header = html.match(/<header class="app-header">[\s\S]*?<\/header>/)[0];
  assert.match(header, /id="fcAdd"/);
  assert.match(header, /class="app-icon-btn"[^>]*id="fcAdd"|id="fcAdd"[^>]*class="app-icon-btn"/);
  assert.match(header, /id="fcAdd"[^>]*hidden/, '#fcAdd starts hidden; setHeader() shows it on the list');

  const list = stripJsComments(read('js/foodcost/foodcost-list.js'));
  assert.doesNotMatch(list, /fc-add/);
  assert.match(list, /empty-action/);

  const main = read('js/foodcost/foodcost-main.js');
  assert.match(main, /addBtn\.hidden = !add/);
  // Only the list route asks for it: every other setHeader() leaves `add` at its default.
  const withAdd = main.match(/setHeader\(\{[^}]*add: true/g) || [];
  assert.equal(withAdd.length, 1);
});

test('the header side is reserved for Food cost and Suppliers by data-card, so Magazzino and Orders are untouched', () => {
  const css = read('tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = css.match(/[^{}]*\{\s*--app-header-side:\s*84px;\s*\}/)[0];
  assert.match(rules, /body\[data-card="foodcost"\] \.app-header/);
  assert.match(rules, /body\[data-card="suppliers"\] \.app-header/);
  assert.doesNotMatch(rules, /data-section="foodcost"/);
  assert.doesNotMatch(rules, /data-section="orders"/);
  const exception = css.match(/@media \(max-width: 359px\) \{[^@]*--app-header-side:\s*auto;/)[0];
  assert.match(exception, /body\[data-card="foodcost"\]/);
  assert.match(exception, /body\[data-card="suppliers"\]/);
});

test('the Suppliers header «+» is reachable by everybody who reaches the page, exactly as the dashed button was', () => {
  const html = read('suppliers.html');
  assert.match(html, /id="registry-add"/);
  assert.doesNotMatch(html.match(/<button[^>]*id="registry-add"[^>]*>/)[0], /hidden/);

  const main = stripJsComments(read('js/orders/registry-main.js'));
  // The page's ONE permission (canManageHere) gates Settings and nothing else. Pin that
  // the add button is never wired to it, by name.
  const gated = main.split('\n').filter(l => /canManageHere/.test(l));
  assert.ok(gated.length > 0);
  for (const line of gated) assert.doesNotMatch(line, /addBtn|registry-add/);
  assert.doesNotMatch(main, /addBtn\.hidden/);

  const registry = stripJsComments(read('js/orders/registry.js'));
  const add = registry.match(/function addCurrent\(\) \{[\s\S]*?\n  \}/)[0];
  assert.doesNotMatch(add, /canManage|isAdmin|hidden/, 'addCurrent must not gate on a role');
  assert.match(add, /openSupplierForm\(null\)/);
  assert.match(add, /openIngredientForm\(null, null, tab === 'packaging' \? 'packaging' : 'ingredient'\)/);
  // The dashed list buttons are gone; the one left inside a supplier's own screen is pre-set to it.
  assert.equal((registry.match(/class: 'mgmt-add'/g) || []).length, 1);
  // The empty-state button and the header «+» share the one function.
  assert.match(registry, /class: 'empty-action'[^}]*onClick: addCurrent/);
});

test('the screen-level empty lists all use the shared .empty-state, not their own class', () => {
  const uses = {
    'js/foodcost/foodcost-list.js': /empty-state[\s\S]*empty-action/,
    'js/catalogue/catalogue-list.js': /empty-state[\s\S]*empty-action/,
    'js/inventory/inventory-list.js': /empty-state/,
    'js/pastries/pastries-day.js': /empty-state/,
    'js/pastries/pastries-logs.js': /empty-state/,
    'js/orders/registry.js': /empty-state/,
  };
  for (const [file, re] of Object.entries(uses)) assert.match(read(file), re, file);
  for (const file of ['js/pastries/pastries-day.js', 'js/pastries/pastries-logs.js']) {
    assert.doesNotMatch(read(file), /pas-empty/);
  }
});

test('the catalogue list has no tray around its rows (a card inside a card)', () => {
  const css = read('catalogue.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = css.match(/\.cat-list-panel \{[^}]*\}/)[0];
  assert.doesNotMatch(rule, /background|border|padding/);
});

// ⚠️ A «+» THAT DOES NOTHING IS WORSE THAN NO «+» (code review, 29 Sep 2026): each of
// these lines could be deleted with every other test green, leaving a dead button on
// screen — and `addBtn?.` would hide a renamed id just as quietly.
test('every new «+» and empty-state action is wired to what it promises', () => {
  const fc = stripJsComments(read('js/foodcost/foodcost-main.js'));
  assert.match(fc, /getElementById\('fcAdd'\)/);
  assert.match(fc, /addBtn\.addEventListener\('click', \(\) => openProduct\(null\)\)/);
  assert.match(fc, /onAdd: \(\) => openProduct\(null\)/);

  const reg = stripJsComments(read('js/orders/registry-main.js'));
  assert.match(reg, /getElementById\('registry-add'\)/);
  assert.match(reg, /addBtn\??\.addEventListener\('click', \(\) => screen\.addCurrent\(\)\)/);
  assert.match(read('suppliers.html'), /id="registry-add"/, 'the id the script looks for exists');

  const cat = stripJsComments(read('js/catalogue/catalogue-main.js'));
  assert.match(cat, /onAdd: \(\) => openEditor\(null\)/);

  for (const [file, pattern] of [
    ['js/catalogue/catalogue-list.js', /class: 'empty-action'[^}]*onclick: onAdd/],
    ['js/foodcost/foodcost-list.js', /class: 'empty-action'[^}]*onclick: onAdd/],
  ]) {
    assert.match(stripJsComments(read(file)), pattern, `${file}: the empty-state button calls onAdd`);
  }
});
