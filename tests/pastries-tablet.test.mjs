// Pastries on a tablet: the seven days as a list on the left, the day's list beside it
// (pastries.css, js/pastries/pastries-strip.js, js/pastries/tablet.js). P15.
//
// No jsdom in this project, so the wiring is pinned at source level. What a later edit could
// quietly break: the vertical list leaking onto the phone, the tablist semantics (roles,
// the roving tab stop, the arrow keys) that the phone's row and the tablet's column share,
// the editor and the records going 1180px wide, the toast stretching, a copy of the tablet
// query drifting, and a feature importing from another.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TABLET_QUERY } from '../js/pastries/tablet.js';
import { TABLET_QUERY as ORDERS_QUERY } from '../js/orders/tablet-layout.js';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const codeOf = (src) => strip(src).replace(/^\s*\/\/.*$/gm, '');

// The text INSIDE the tablet query and the text outside it.
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

const { inside, outside } = halves(read('pastries.css'));
const STRIP = codeOf(read('js/pastries/pastries-strip.js'));

test('Pastries tablet query is the app\'s one query, word for word', () => {
  assert.equal(TABLET_QUERY, ORDERS_QUERY);
  assert.ok(read('pastries.css').includes(`@media ${TABLET_QUERY}`));
});

test('Pastries widens on its data-card', () => {
  const tokens = strip(read('tokens.css'));
  assert.match(tokens.slice(tokens.indexOf('@media (min-width: 900px)')), /body\[data-card="pastries"\]/);
  assert.match(read('pastries.html'), /<body data-section="pastries" data-card="pastries">/);
});

test('tablet.js is in the service worker\'s ASSETS and fingerprinted', () => {
  const sw = read('sw.js');
  assert.match(sw, /'\.\/js\/pastries\/tablet\.js'/);
  assert.match(sw, /"\.\/js\/pastries\/tablet\.js":/);
});

test('Pastries never imports from another feature\'s folder', () => {
  for (const file of ['js/pastries/pastries-strip.js', 'js/pastries/pastries-main.js', 'js/pastries/tablet.js']) {
    assert.doesNotMatch(read(file), /from\s+['"]\.\.\/(orders|catalogue|foodcost|inventory)\//, `${file} reaches into another feature`);
  }
});

test('the vertical list and the page grid exist only under the tablet query', () => {
  assert.match(inside, /body\[data-card="pastries"\]\s*\{[^}]*display:\s*grid/);
  assert.match(inside, /grid-template-columns:\s*var\(--app-gutter\) 316px minmax\(0, 1fr\) var\(--app-gutter\)/);
  assert.match(inside, /\.pas-strip\s*\{[^}]*flex-direction:\s*column/);
  assert.doesNotMatch(outside, /body\[data-card="pastries"\]/, 'no Pastries body rule outside the tablet query');
  // The phone strip is still seven equal columns.
  assert.match(outside, /\.pas-strip\s*\{[^}]*grid-template-columns:\s*repeat\(7, 1fr\)/);
});

test('the tablet-only parts of a chip are hidden on a phone and shown on a tablet', () => {
  assert.match(outside, /\.pas-chip-full\s*\{\s*display:\s*none;\s*\}/);
  assert.match(outside, /\.pas-chip-count\s*\{\s*display:\s*none;\s*\}/);
  assert.match(inside, /\.pas-chip-full\s*\{[^}]*display:\s*block/);
  assert.match(inside, /\.pas-chip-count\s*\{[^}]*display:\s*block/);
  assert.match(inside, /\.pas-chip-label\s*\{\s*display:\s*none;\s*\}/, 'the abbreviation gives way to the full name');
});

test('the tablist semantics are the same for the row and the column', () => {
  assert.match(read('pastries.html'), /<div class="pas-strip" id="pasStrip" role="tablist"/);
  assert.match(STRIP, /role: 'tab'/);
  assert.match(STRIP, /'aria-selected': day === active \? 'true' : 'false'/);
  assert.match(STRIP, /tabindex: day === active \? '0' : '-1'/);
  assert.match(STRIP, /chip\.tabIndex = on \? 0 : -1/);
  // Both pairs of arrows, Home and End.
  assert.match(STRIP, /'ArrowRight' \|\| e\.key === 'ArrowDown'\) next = \(index \+ 1\) % 7/);
  assert.match(STRIP, /'ArrowLeft' \|\| e\.key === 'ArrowUp'\) next = \(index \+ 6\) % 7/);
  assert.match(STRIP, /e\.key === 'Home'/);
  assert.match(STRIP, /e\.key === 'End'/);
  // Said out loud: a column on a tablet, a row on a phone, following a rotation.
  assert.match(STRIP, /host\.setAttribute\('aria-orientation', isTabletNow\(\) \? 'vertical' : 'horizontal'\)/);
  assert.match(STRIP, /watchTablet\(/);
});

test('every chip carries the day\'s count, from the same map that quietens an empty day', () => {
  assert.match(STRIP, /pas-chip-count/);
  assert.match(STRIP, /classList\.toggle\('pas-chip--empty', !\(n > 0\)\)/);
  assert.match(STRIP, /\.pas-chip-count'\)\.textContent = String\(n > 0 \? n : 0\)/);
  // The full name is painted in the language, again when it changes, and the accessible
  // name is still the day alone.
  assert.match(STRIP, /\.pas-chip-full'\)\.textContent = weekdayLabel\(day\)/);
  assert.match(STRIP, /chip\.setAttribute\('aria-label', weekdayLabel\(day\)\)/);
});

test('the day\'s list is at kitchen size on the tablet only', () => {
  assert.match(inside, /\.pas-chip\s*\{[^}]*height:\s*var\(--tap-min\)/);
  assert.match(inside, /\.pas-row-main\s*\{[^}]*min-height:\s*var\(--tap-min\)/);
  assert.match(inside, /\.pas-row-qty\s*\{[^}]*font-size:\s*calc\(var\(--qty-font\) \+ 6px\)/);
  assert.match(inside, /input\.pas-quick\s*\{[^}]*height:\s*var\(--tap-min\)/);
  assert.match(inside, /\.pas-confirm-btn, \.pas-edit-btn\s*\{[^}]*height:\s*var\(--tap-min\)/);
  assert.match(outside, /input\.pas-quick\s*\{[^}]*height:\s*44px/);
});

test('the editor and the records keep a 620px column, and the toast its own', () => {
  assert.match(inside, /\.pas-strip\[hidden\] ~ \.pas-screen\s*\{\s*grid-column:\s*2 \/ 4;\s*\}/);
  assert.match(inside, /\.pas-strip\[hidden\] ~ \.pas-screen > \*\s*\{\s*max-width:\s*620px/);
  assert.match(inside, /body\[data-card="pastries"\] \.pas-toast\s*\{[^}]*--app-max-width:\s*620px[^}]*--app-gutter:\s*max\(0px, calc\(\(100% - var\(--app-max-width\)\) \/ 2\)\)/);
  // Both screens hide the strip, which is what the rule above hangs on.
  const main = codeOf(read('js/pastries/pastries-main.js'));
  assert.equal((main.match(/stripHost\.hidden = true;/g) || []).length, 2, 'the editor and the records must hide the strip');
});

test('the lock and the work-day roll are not part of this layout', () => {
  assert.doesNotMatch(STRIP, /pastries-lock|workDate|provingDayFor/);
  assert.doesNotMatch(inside + outside, /\.pas-confirm-btn\s*\{[^}]*display:\s*none/);
});
