// The tablet query is an OR: (900 wide and 600 tall) or 1000 wide. The on-screen keyboard
// shrinks the page's HEIGHT, never its width, so a 1024-wide tablet can no longer flip to the
// phone layout when it opens (the SM-T550 «Calcola» bounce, 9 Oct 2026). No browser here: a
// tiny evaluator for exactly this query shape, run on named sizes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { TABLET_QUERY as CATALOGUE } from '../js/catalogue/tablet.js';
import { TABLET_QUERY as FOODCOST } from '../js/foodcost/tablet.js';
import { TABLET_QUERY as ORDERS } from '../js/orders/tablet-layout.js';
import { TABLET_QUERY as PASTRIES } from '../js/pastries/tablet.js';

const tokens = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const prelude = tokens.match(/@media\s+([^{]*min-width:\s*900px[^{]*)\{/)[1].trim();

// A comma list of conjunctions of (min-width: Npx) / (min-height: Npx).
function matches(query, width, height) {
  return query.split(',').some((part) => part.split(' and ').every((cond) => {
    const m = cond.trim().match(/^\(min-(width|height):\s*(\d+)px\)$/);
    assert.ok(m, `unsupported condition: ${cond}`);
    return (m[1] === 'width' ? width : height) >= Number(m[2]);
  }));
}

const CASES = [
  ['tablet landscape 1024×768', 1024, 768, true],
  ['tablet landscape, keyboard open 1024×420', 1024, 420, true],
  ['tablet 1280×800', 1280, 800, true],
  ['phone sideways 844×390', 844, 390, false],
  ['phone sideways 932×430', 932, 430, false],
  ['phone sideways 915×412', 915, 412, false],
  ['tablet portrait 768×1024', 768, 1024, false],
  ['768×600', 768, 600, false],
  ['phone portrait 360×800', 360, 800, false],
];

for (const [name, w, h, expected] of CASES) {
  test(`the tablet query is ${expected} for ${name}`, () => {
    assert.equal(matches(prelude, w, h), expected);
  });
}

test('the four JS copies read exactly the CSS prelude', () => {
  for (const q of [CATALOGUE, FOODCOST, ORDERS, PASTRIES]) assert.equal(q, prelude);
});
