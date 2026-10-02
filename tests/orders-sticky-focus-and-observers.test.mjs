// Review follow-ups (1 Oct 2026): (F) a box focused in the Orders list is scrolled to BELOW
// the pinned bars, and (G) the ResizeObservers behind them are ended when the list is dropped.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const css = read('orders.css');

test('the Orders scroller keeps focused boxes clear of all three pinned bars', () => {
  const m = css.match(/body\[data-section="orders"\] \.scroll-area \{([^}]*)\}/);
  assert.ok(m, 'scroll-padding rule missing');
  assert.match(m[1],
    /scroll-padding-top:\s*calc\(var\(--order-head-h,\s*0px\)\s*\+\s*var\(--order-search-h,\s*0px\)\s*\+\s*var\(--order-ing-head-h,\s*0px\)\)/);
  assert.match(css, /--order-ing-head-h:\s*0px/, 'an honest default before the first measurement');
});

test('the Order / Stock header height is measured, and re-measured after every repaint', () => {
  const list = read('js/orders/ingredient-list.js');
  assert.match(list, /trackSwappableHead\('--order-ing-head-h'\)/);
  assert.match(list, /ingHead\?\.watch\(listEl\.firstElementChild\)/);
  assert.match(list, /ingHead\?\.watch\(null\)/, 'no header (empty list) means no offset');
});

test('the list keeps its observers and ends them in destroy()', () => {
  const list = read('js/orders/ingredient-list.js');
  assert.match(list, /const searchObserver = trackStickyHead\(/);
  assert.match(list, /destroy\(\) \{[\s\S]*searchObserver\?\.disconnect\(\);[\s\S]*ingHead\.stop\(\);/);
});

test('orders-main destroys the flat list wherever it drops it', () => {
  const main = read('js/orders/orders-main.js');
  assert.match(main, /function dropFlatView\(\) \{\s*flatView\?\.destroy\(\);\s*flatView = null;\s*\}/);
  assert.match(main, /function dropListViews\(\) \{\s*dropFlatView\(\);/);
  assert.match(main, /if \(!cardsView\) \{\s*dropFlatView\(\);/);
  assert.equal((main.match(/^\s+flatView = null;/gm) || []).length, 1,
    'the only place that nulls the handle is dropFlatView, which destroys it first');
});

test('trackSwappableHead disconnects the previous observer and zeroes on stop', async () => {
  const seen = { observed: [], disconnected: 0 };
  globalThis.ResizeObserver = class {
    constructor(cb) { this.cb = cb; }
    observe(n) { seen.observed.push(n); }
    disconnect() { seen.disconnected += 1; }
  };
  const props = {};
  const root = { style: { setProperty: (k, v) => { props[k] = v; } } };
  const { trackSwappableHead } = await import('../js/orders/sticky-offset.js');
  const tracker = trackSwappableHead('--x', root);
  tracker.watch({ offsetHeight: 40 });
  assert.equal(props['--x'], '40px');
  tracker.watch({ offsetHeight: 55 });
  assert.equal(seen.disconnected, 1, 'the old node is released when a new one is watched');
  assert.equal(props['--x'], '55px');
  tracker.stop();
  assert.equal(seen.disconnected, 2);
  assert.equal(props['--x'], '0px');
  delete globalThis.ResizeObserver;
});
