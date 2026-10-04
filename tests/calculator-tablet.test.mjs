// The Calculator on a tablet (style.css, tokens.css). P15.
//
// Layout only: a confirmed recipe tab keeps its greyed fields AND its result in the same
// panel (js/calc.js), so quantities-left / recipe-right is CSS. No jsdom here, so the
// rules are pinned at source level: the layout must exist ONLY under the one tablet query
// and ONLY for body[data-card="calculator"] (orders.html and suppliers.html load style.css
// too), the fixed screens must keep their 620px column, and the shared rules that are the
// project's known collisions (.ing-row, .cp-*) must not be touched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TABLET_QUERY } from '../js/orders/tablet-layout.js';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

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

const sheet = read('style.css');
const { inside, outside } = halves(sheet);

test('the Calculator uses the app\'s one tablet query, word for word', () => {
  assert.ok(sheet.includes(`@media ${TABLET_QUERY}`));
});

test('the Calculator widens on its data-card, and calculator.html carries it', () => {
  const tokens = strip(read('tokens.css'));
  assert.match(tokens.slice(tokens.indexOf('@media (min-width: 900px)')), /body\[data-card="calculator"\]/);
  assert.match(read('calculator.html'), /<body data-section="calculator" data-card="calculator">/);
});

test('a confirmed recipe tab is ONE column on a tablet: no grid, no :has() (4 Oct 2026)', () => {
  assert.ok(!strip(sheet).includes(':has('), 'no :has() rule anywhere in style.css');
  assert.doesNotMatch(inside, /display:\s*grid|grid-template|grid-column|grid-row/);
  assert.doesNotMatch(outside, /body\[data-card="calculator"\]/, 'no Calculator body rule outside the tablet query');
  assert.ok(inside.includes('body[data-card="calculator"] #recipe-tabs > .content:not(#tab-empty) { margin-inline: 0 auto; }'));
});

test('every tablet rule of this section is scoped to the Calculator', () => {
  const rules = [...inside.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1].trim());
  assert.ok(rules.length > 0);
  for (const sel of rules) {
    for (const part of sel.split(',').map((s) => s.trim()).filter(Boolean)) {
      assert.match(part, /^body\[data-card="calculator"\]/, `unscoped tablet selector: ${part}`);
    }
  }
});

test('the quantity fields take the kitchen sizes on a tablet', () => {
  assert.match(inside, /input\[type="number"\][^{]*\{[^}]*min-height:\s*var\(--tap-min\)[^}]*font-size:\s*var\(--qty-font\)/);
});

test('every fixed screen keeps its 620px column', () => {
  const block = inside.slice(inside.indexOf('#recipe-overlay'));
  for (const id of ['recipe', 'settings', 'extra', 'divisor', 'cosettings', 'logsettings', 'wa', 'cp', 'clientorders']) {
    assert.ok(block.includes(`#${id}-overlay`), `#${id}-overlay must re-declare the 620px gutter`);
  }
  assert.ok(block.includes('.log-overlay'));
  assert.match(block, /--app-max-width:\s*620px/);
  assert.match(block, /--app-gutter:\s*max\(0px, calc\(\(100% - var\(--app-max-width\)\) \/ 2\)\)/);
  // The four screens of the Log are all of the .log-overlay kind.
  const html = read('calculator.html');
  assert.equal((html.match(/class="log-overlay"/g) || []).length, 4);
  // Every overlay of the page is covered.
  for (const [, id] of html.matchAll(/<div id="([a-z]+)-overlay"/g)) {
    if (['logview', 'logedit', 'logadd', 'loghistory'].includes(id)) continue;
    assert.ok(block.includes(`#${id}-overlay`), `#${id}-overlay is not covered`);
  }
});

test('the tablet block never touches .ing-row or the shared .cp-* classes', () => {
  assert.doesNotMatch(inside, /\.ing-row|\.cp-/);
});

test('no new file: the Calculator tablet layout is CSS only (nothing to precache)', () => {
  const sw = read('sw.js');
  assert.doesNotMatch(sw, /calculator-tablet/);
});

// ⚠️ a646ef4, found by driving: the side screens' HEADERS sat in the 620px column while
// their bodies (flat 16px padding) ran the full 1180px. Pinned so deleting it goes red.
test('the side screens\' bodies pad with the 620px gutter, the recipe sheet excepted', () => {
  assert.match(inside, /body\[data-card="calculator"\] \.recipe-scroll > :not\(#recipe-content\)\s*\{\s*padding-inline:\s*max\(16px, var\(--app-gutter\)\);\s*\}/);
});
