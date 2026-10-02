// Source-level check (P15): in the «per ingrediente» view the tab bar, then the search row
// and the filter pills, then the Order / Stock header stay pinned in that order while the
// list scrolls (Federico, 1 Oct 2026). Each height is MEASURED (sticky-offset.js), never a
// pixel guess; these checks keep the pieces from being undone one at a time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../js/orders/ingredient-list.js', import.meta.url), 'utf8');
const offset = readFileSync(new URL('../js/orders/sticky-offset.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../orders.css', import.meta.url), 'utf8');
const rule = sel => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\n)${esc} \\{([^}]*)\\}`));
  assert.ok(m, `${sel} rule missing from orders.css`);
  return m[1];
};

test('the search row and the filter pills share one sticky bar, and its height is measured', () => {
  assert.match(js, /el\('div', \{ class: 'ing-sticky-head' \}, \[searchRow, filterSwitch\]\)/);
  assert.match(js, /trackStickyHead\(stickyHead, document\.body, '--order-search-h'\)/);
  assert.match(offset, /ResizeObserver/);
  assert.match(offset, /property = '--order-head-h'/);
});

test('the bar sticks under the tab bar, on an opaque ground, with its margins inside', () => {
  const r = rule('.ing-sticky-head');
  assert.match(r, /position:\s*sticky/);
  assert.match(r, /top:\s*var\(--order-head-h,\s*0px\)/);
  assert.match(r, /z-index:\s*\d/);
  assert.match(r, /background:\s*var\(--surface\)/);
  assert.match(r, /display:\s*flow-root/, 'a collapsing bottom margin would open a gap rows show through');
});

test('the Order / Stock header sticks under the tabs AND the bar', () => {
  assert.match(rule('.ing-flat-list > .ing-head'),
    /top:\s*calc\(var\(--order-head-h,\s*0px\)\s*\+\s*var\(--order-search-h,\s*0px\)\)/);
});
