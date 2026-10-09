// Every page tells the browser that the on-screen keyboard must NOT shrink the page.
//
// ⚠️ THE TABLET THAT JUMPED (5 Oct 2026, the SM-T550 in landscape, 1024×768): tapping a
// text box in a two-pane screen opened the keyboard, the keyboard RESIZED the page to about
// 1024×420, and 420 is below the tablet query's 600px floor (tokens.css — the floor that
// keeps a phone turned sideways on the phone layout). So the page flipped to the phone
// layout, the form moved out of its pane and lost the focus, the keyboard closed, the page
// grew back to 768, the tablet layout returned — and round again: «salta su e giù».
//
// `interactive-widget=resizes-visual` makes the keyboard cover the page instead (only the
// visual viewport shrinks, and the browser scrolls the focused box into view), which is
// what iOS Safari always does. The layout viewport — what every media query reads — keeps
// its height, so a keyboard can never cross the tablet query again. Browsers that do not
// know the key ignore it.
//
// 9 Oct 2026: the meta was NOT enough on the real tablet — the SM-T550 browser still
// resized the layout viewport to ~1024×420 and the Ricettario «Calcola» bounced. So the
// tablet query has a width half, `(min-width: 1000px)`, that does not depend on the browser
// honouring anything: a keyboard changes the height, never the width (tests/tablet-keyboard-width.test.mjs).
//
// The second guard already exists: a form moved by a REAL crossing (a rotation) gets its
// focus and caret back — js/orders/registry.js moveOverlay, js/foodcost/foodcost-main.js
// moveEditor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);

const pages = readdirSync(root).filter((name) => name.endsWith('.html'));

test('every page with a viewport meta keeps the keyboard from resizing the page', () => {
  const withMeta = pages.filter((name) => /<meta name="viewport"/.test(readFileSync(new URL(name, root), 'utf8')));
  // Every real page has one; only the redirect stub (home.html) may go without.
  assert.ok(withMeta.length >= 11, `only ${withMeta.length} pages carry a viewport meta`);
  for (const name of withMeta) {
    const html = readFileSync(new URL(name, root), 'utf8');
    const content = html.match(/<meta name="viewport" content="([^"]*)"/)[1];
    assert.match(content, /(^|,\s*)interactive-widget=resizes-visual(\s*,|$)/, `${name}: ${content}`);
  }
});

test('the pages without a viewport meta are only the redirect stub', () => {
  const without = pages.filter((name) => !/<meta name="viewport"/.test(readFileSync(new URL(name, root), 'utf8')));
  assert.deepEqual(without, ['home.html']);
});
