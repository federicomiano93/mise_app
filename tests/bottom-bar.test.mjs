// The bottom bar — the one this app has now got wrong twice.
//
// ⚠️⚠️ v1.62.0 FOUND THIS DEFECT, WROTE IT DOWN IN A COMMENT, AND FIXED ONE OF THE
// FOUR BARS. Federico photographed the same pale band on «Fornitori e ingredienti» the
// next day. A comment explaining a defect does not stop it; the reason .cat-footer
// stayed right and .recipe-footer did not is that nothing asserted the rule.
//
// THE RULE, measured in a real browser on 23 Aug 2026 on all four pages that have a bar:
//
//     the BAR is the page's own ground      var(--bg)       rgb(244,237,224)
//     the BUTTON is the raised surface      var(--surface)  rgb(255,253,247)
//
// Inverted, the bar paints a pale band across a page that is not pale and the button
// all but disappears into it. Pastries and the Catalogue read correctly; the values
// here are theirs, and nothing was designed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const STYLE = read('style.css');
const CATALOGUE = read('catalogue.css');

// The declaration block of one rule, so a value elsewhere in the file cannot answer
// for it. ⚠️ Anchored to the start of a line: `.recipe-footer` is a prefix of
// `.recipe-footer-btn`, and matching loosely would read the button's block as the bar's.
function block(css, selector) {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at > 0, `${selector} is not defined — an unstyled class is as silent as an undefined custom property`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  assert.ok(close > open, `${selector} has no closing brace`);
  return css.slice(open + 1, close);
}

test('⚠️⚠️ the bar is the page’s own ground and the button is the raised surface', () => {
  const bar = block(STYLE, '.recipe-footer');
  const button = block(STYLE, '.recipe-footer-btn');
  assert.match(bar, /background:\s*var\(--bg\)/,
    'the bar took var(--surface) until v1.70.0 and painted a pale band across three pages');
  assert.match(button, /background:\s*var\(--surface\)/,
    'and the button must be the raised one, or it vanishes into the bar');
  assert.doesNotMatch(bar, /background:\s*var\(--surface\)/);
  assert.doesNotMatch(button, /background:\s*var\(--surface2\)/,
    '--surface2 on the button is the other half of the inverted pair');
});

// ⚠️ THE PAIR IS THE SAME ONE THE TWO CORRECT BARS ALREADY USE. This is what makes the
// fix a completed copy rather than a new opinion — and it fails if somebody "improves"
// one of the three and leaves the others behind, which is exactly how this happened.
test('and it is the same pairing .cat-footer settled on', () => {
  // ⚠️ catalogue.css SPEAKS THROUGH ITS OWN ALIASES — --cat-ground, --cat-surface —
  // so the two bars cannot be compared by token NAME. My first version of this test
  // demanded var(--bg) here and went red on a perfectly correct stylesheet. Follow the
  // alias to what it actually resolves to, which is the only comparison that means
  // anything: the browser measured both bars at rgb(244,237,224) on 23 Aug 2026.
  assert.match(CATALOGUE, /--cat-ground:\s*var\(--bg\)/,
    'the catalogue’s ground alias must still be the shared page ground');
  assert.match(CATALOGUE, /--cat-surface:\s*var\(--surface\)/);
  const cat = block(CATALOGUE, '.cat-footer');
  const catBtn = block(CATALOGUE, '.cat-footer-btn');
  assert.match(cat, /background:\s*var\(--cat-ground\)/, '.cat-footer is the reference and must stay so');
  assert.match(catBtn, /background:\s*var\(--cat-surface\)/);
});

// ── The bar must not float in the middle of a short page ─────────────────────
//
// Federico's photograph: «Fornitori» with ONE supplier and the bar halfway down the
// screen. Measured on all three pages that carry it, and all three did it.
//
// ⚠️ THE BAR STAYS INSIDE THE SCROLL AREA — that is what makes it scroll away behind an
// open form instead of hovering over somebody's Save. It is pushed down, not taken out.
test('⚠️ every page whose last child is the bar pins it to the bottom when short', () => {
  const rule = block(STYLE, '.scroll-with-bar');
  assert.match(rule, /display:\s*flex/);
  assert.match(rule, /flex-direction:\s*column/);
  assert.match(STYLE, /\.scroll-with-bar > \* \{[^}]*flex-shrink:\s*0/,
    'without flex-shrink:0 a long list is squashed instead of scrolled — the same '
    + 'sentence .home-scroll’s own comment carries');
  assert.match(STYLE, /\.scroll-with-bar > \.recipe-footer \{[^}]*margin-top:\s*auto/,
    'margin-top:auto on the bar is what drops it to the bottom of a short page');
});

// ⚠️ AND THAT THE PAGES ACTUALLY CARRY IT. A rule nothing uses is a rule that passes
// for ever — the v1.68.0 lesson: pin that the call EXISTS, not only its shape.
test('⚠️ and all three pages that have the bar actually opt in', () => {
  for (const page of ['suppliers.html', 'orders.html', 'calculator.html']) {
    const src = read(page);
    assert.match(src, /class="recipe-footer"/, `${page} is expected to have the bar`);
    assert.match(src, /^<div class="scroll-area scroll-with-bar">$/m,
      `${page}: the PAGE-LEVEL scroll area must opt in — ⚠️ orders.html has a second, `
      + 'nested one inside the history overlay, and that one must be left alone');
  }
});

// The two pages that pin their bar OUTSIDE the scroller must not gain the class:
// there is no spare space to consume there, and the class would only mislead.
test('the pages that pin their bar outside the scroller stay as they are', () => {
  for (const page of ['catalogue.html', 'pastries.html']) {
    assert.doesNotMatch(read(page), /scroll-with-bar/,
      `${page} keeps its bar outside the scroll area and hides it per screen`);
  }
});
