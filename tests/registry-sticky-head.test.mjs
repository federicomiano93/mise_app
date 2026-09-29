// Source-level check (P15): on «Ingredienti e fornitori» the list switch and the search
// stay pinned while the list scrolls (Federico, 29 Sep 2026). Measured in a browser at
// 296, 360 and tablet width; this keeps the three pieces that make it work from being
// undone one at a time — the wrapper, the sticky rule, and the tablet's padding offset.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../js/orders/registry.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../orders.css', import.meta.url), 'utf8');

test('the switch and the search share one sticky wrapper, above the list', () => {
  assert.match(js, /el\('div', \{ class: 'reg-sticky-head' \}, \[viewSwitch, search\.node\]\)/);
  assert.match(js, /el\('div', \{\}, \[head, listHost\]\)/);
});

test('the wrapper sticks, on an opaque ground, above the rows', () => {
  const rule = css.match(/\.reg-sticky-head \{([^}]*)\}/);
  assert.ok(rule, '.reg-sticky-head rule missing from orders.css');
  assert.match(rule[1], /position:\s*sticky/);
  assert.match(rule[1], /top:\s*0/);
  assert.match(rule[1], /z-index:\s*\d/);
  assert.match(rule[1], /background:\s*var\(--bg\)/);
});

test('on a tablet it sticks to the scroller edge, not 14px below it', () => {
  assert.match(css, /\.app-split-list \.reg-sticky-head \{ top: -14px; \}/);
});
