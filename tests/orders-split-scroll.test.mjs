// The tablet split scrolls in TWO columns and never the page (Federico, 29 Sep 2026:
// «lo scorrimento separato non funziona bene tra gli ingredienti e i fornitori»).
// Measured on 1180x820: wheeling over the pane scrolled it to its end and then dragged
// the page, taking the supplier list up and the pane's header out of sight. Nothing here
// sees a pixel; it pins the source facts that make the page unscrollable in this mode.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../orders.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const SPLIT = 'body[data-section="orders"][data-orders-tab="order"][data-orders-view="suppliers"]';

// Every tablet media block (balanced braces), joined, and the sheet without them.
const TABLET = '@media (min-width: 900px) and (min-height: 600px)';
const blocks = [];
for (let at = CSS.indexOf(TABLET); at >= 0; at = CSS.indexOf(TABLET, at + 1)) {
  let i = CSS.indexOf('{', at) + 1;
  const from = i;
  let depth = 1;
  while (i < CSS.length && depth > 0) { if (CSS[i] === '{') depth += 1; else if (CSS[i] === '}') depth -= 1; i += 1; }
  blocks.push(CSS.slice(from, i - 1));
}
assert.ok(blocks.length, 'the tablet query is missing');
const BLOCK = blocks.join('\n');
const OUTSIDE = blocks.reduce((css, b) => css.replace(b, ''), CSS);

// Declarations of every rule inside the tablet block whose selector list has `selector`.
function tabletRule(selector) {
  const found = [];
  for (const m of BLOCK.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map((x) => x.trim()).includes(selector)) found.push(m[2]);
  }
  assert.ok(found.length, `the tablet block has no rule for ${selector}`);
  return found.join('\n');
}

test('in split mode the page scroller does not scroll', () => {
  assert.match(tabletRule(`${SPLIT} > .scroll-area.scroll-with-bar`), /overflow-y:\s*hidden/);
});

test('every box from the page down to the split fills what is left, and may shrink', () => {
  for (const sel of [`${SPLIT} .scroll-area > .orders-column`, `${SPLIT} .orders-column > .order-box`,
    `${SPLIT} .order-box > #tab-order.active`, `${SPLIT} .orders-split`]) {
    const r = tabletRule(sel);
    assert.match(r, /flex:\s*1 1 0/, `${sel} must fill the space`);
    assert.match(r, /min-height:\s*0/, `${sel} must be allowed to shrink`);
  }
  assert.match(tabletRule(`${SPLIT} .order-box > #tab-order.active`), /display:\s*flex/);
  // The notices and the buttons after the split keep their own height.
  assert.match(tabletRule(`${SPLIT} .orders-column > *`), /flex-shrink:\s*0/);
  assert.match(tabletRule(`${SPLIT} #tab-order > *`), /flex-shrink:\s*0/);
});

test('the two columns are full height and the grid row cannot grow past them', () => {
  const r = tabletRule(`${SPLIT} .orders-split`);
  assert.match(r, /grid-template-columns:\s*372px 1fr/);
  assert.match(r, /grid-template-rows:\s*minmax\(0,\s*1fr\)/);
  assert.match(r, /align-items:\s*stretch/);
});

test('left column: the search and the filter stay, only the supplier rows scroll', () => {
  assert.match(tabletRule(`${SPLIT} #suppliers-list`), /display:\s*flex/);
  assert.match(tabletRule(`${SPLIT} #suppliers-list`), /flex-direction:\s*column/);
  const r = tabletRule(`${SPLIT} #suppliers-list > .supplier-list`);
  assert.match(r, /overflow-y:\s*auto/);
  assert.match(r, /overscroll-behavior:\s*contain/);
  assert.match(r, /min-height:\s*0/);
});

test('right column: not sticky any more, its body scrolls on its own', () => {
  const pane = tabletRule(`${SPLIT} #orders-detail-pane`);
  assert.doesNotMatch(pane, /position:\s*sticky/);
  assert.doesNotMatch(pane, /max-height/);
  assert.doesNotMatch(BLOCK, /calc\(100vh - 24px\)/);
  assert.match(tabletRule(`${SPLIT} #orders-detail-pane .supplier-detail-body`), /overscroll-behavior:\s*contain/);
});

test('none of it reaches the phone, the Incoming tab or the flat list', () => {
  // Every split-mode rule is inside the tablet query AND under the three-attribute scope.
  assert.doesNotMatch(OUTSIDE, /data-orders-view="suppliers"/);
  for (const m of BLOCK.matchAll(/([^{}]+)\{/g)) {
    for (const raw of m[1].split(',')) {
      const sel = raw.trim();
      if (/#suppliers-list >|\.orders-split|#orders-detail-pane \.supplier-detail-body/.test(sel)
          && /scroll|overflow/.test(sel) === false) {
        assert.ok(sel.startsWith(SPLIT), `unscoped split rule: ${sel}`);
      }
    }
  }
  // The page scroller keeps scrolling everywhere else.
  assert.match(readFileSync(new URL('../style.css', import.meta.url), 'utf8'), /\.scroll-area \{[^}]*overflow-y:\s*auto/);
});
