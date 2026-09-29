// One shared green header, defined ONCE in tokens.css (P15).
//
// ⚠️ WHY THIS IS PINNED. Seven screens each carried their own copy of the bar
// (.orders-header, .cat-header, .pas-header, .fc-header, .inv-header …) and the copies
// drifted: Food cost and Magazzino were flat with a sans title, the Calculator showed
// the venue's name where every other screen shows its own. The centring is a grid —
// `minmax(side, 1fr) auto minmax(side, 1fr)` — and it only works when the bar has EXACTLY three
// children (left slot, title, right slot): a fourth loose button lands in a track of
// its own and pushes the title off centre with every test green. No unit test can see
// that, so the shape is pinned here instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
const PAGES = readdirSync(root).filter(f => f.endsWith('.html'));

// Element children of each <header class="… app-header …">, by a tag walk. Self-closing
// tags (the svg paths) and comments are skipped.
function appHeaders(html) {
  const clean = html.replace(/<!--[\s\S]*?-->/g, '');
  const tag = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  const found = [];
  let current = null;
  let depth = 0;
  let m;
  while ((m = tag.exec(clean))) {
    const [, closing, name, attrs, selfClosing] = m;
    if (!current) {
      if (!closing && name === 'header') {
        current = { attrs, children: [] };
        depth = 0;
      }
      continue;
    }
    if (closing) {
      if (depth === 0 && name === 'header') { found.push(current); current = null; continue; }
      depth -= 1;
      continue;
    }
    if (depth === 0) current.children.push({ name, attrs });
    if (!selfClosing) depth += 1;
  }
  return found;
}

const classesOf = attrs => (attrs.match(/class="([^"]*)"/)?.[1] || '').split(/\s+/);

// The Home's own bar is not a section header: it carries the venue's name and the
// business switcher, and is a different shape on purpose.
const isHome = header => classesOf(header.attrs).includes('home-header');

// ⚠️ ABSOLUTELY POSITIONED, so it takes no grid cell: the Orders notices panel hangs
// from the bar it is anchored to (see the note in orders.html).
const takesNoCell = child => /id="orders-alerts-panel"/.test(child.attrs);

test('every section header in the pages is an .app-header with exactly three children', () => {
  let seen = 0;
  for (const page of PAGES) {
    for (const header of appHeaders(read(page))) {
      if (isHome(header)) continue;
      seen += 1;
      assert.ok(classesOf(header.attrs).includes('app-header'), `${page}: a <header> without app-header`);
      const cells = header.children.filter(child => !takesNoCell(child));
      assert.equal(cells.length, 3, `${page}: ${cells.length} children, must be slot · title · slot`);
      assert.ok(classesOf(cells[0].attrs).includes('app-header-slot'), `${page}: first child is not a slot`);
      assert.ok(classesOf(cells[1].attrs).includes('app-header-title'), `${page}: middle child is not the title`);
      assert.ok(classesOf(cells[2].attrs).includes('app-header-slot'), `${page}: last child is not a slot`);
    }
  }
  assert.ok(seen >= 8, `only ${seen} headers found — the walk is broken`);
});

// The walk above is only believed once it is shown to FAIL on a four-child bar.
test('the header walk counts a fourth loose child', () => {
  const bad = '<header class="app-header"><span class="app-header-slot"></span>'
    + '<div class="app-header-title"></div><span class="app-header-slot"></span><button></button></header>';
  const [header] = appHeaders(bad);
  assert.equal(header.children.length, 4);
});

test('every header built in JS is an .app-header too', () => {
  const dirs = ['js', 'js/orders', 'js/staff', 'js/foodcost', 'js/catalogue', 'js/inventory', 'js/pastries'];
  const offenders = [];
  let seen = 0;
  for (const dir of dirs) {
    let files = [];
    try { files = readdirSync(new URL(`${dir}/`, root)).filter(f => f.endsWith('.js')); } catch { continue; }
    for (const file of files) {
      const source = read(`${dir}/${file}`);
      for (const call of source.matchAll(/(?:el|node)\('header',\s*(\{[^}]*\}|'[^']*')/g)) {
        seen += 1;
        if (!/app-header/.test(call[1])) offenders.push(`${dir}/${file}: ${call[1]}`);
      }
    }
  }
  assert.ok(seen >= 12, `only ${seen} JS headers found — the search is broken`);
  assert.deepEqual(offenders, []);
});

test('tokens.css centres the title with three tracks, side auto side', () => {
  const css = stripComments(read('tokens.css'));
  const rule = css.match(/(^|\n)\.app-header\s*\{([^}]*)\}/);
  assert.ok(rule, '.app-header is missing from tokens.css');
  assert.match(rule[2], /display:\s*grid/);
  assert.match(rule[2],
    /grid-template-columns:\s*minmax\(var\(--app-header-side\),\s*1fr\) auto minmax\(var\(--app-header-side\),\s*1fr\)/,
    'the two side tracks must stay IDENTICAL, or the title stops being centred');
  assert.match(rule[2], /--app-header-side:\s*auto;/,
    'the default reserves what each side holds — a fixed 0 let buttons cover the title below 360px');
  assert.match(rule[2], /border-radius:\s*0 0 26px 26px/);
  assert.match(rule[2], /background:\s*var\(--brand\)/);
});

test('the subtitle is one line with an ellipsis, the title serif', () => {
  const css = stripComments(read('tokens.css'));
  const sub = css.match(/\.app-header-title p\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(sub, /white-space:\s*nowrap/);
  assert.match(sub, /overflow:\s*hidden/);
  assert.match(sub, /text-overflow:\s*ellipsis/);
  const title = css.match(/\.app-header-title h1\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(title, /font-family:\s*var\(--font-display\)/);
});

test('the round button is 36px to look at and 44px to touch, without a layout change', () => {
  const css = stripComments(read('tokens.css'));
  const before = css.match(/\.app-icon-btn::before[^{]*\{([^}]*)\}/);
  assert.ok(before, '.app-icon-btn::before is missing');
  assert.match(before[1], /position:\s*absolute/);
  assert.match(before[1], /inset:\s*-5\.5px/);
  const button = css.match(/(^|\n)\.app-icon-btn\s*\{([^}]*)\}/)?.[2] || '';
  assert.match(button, /width:\s*36px/);
  assert.match(button, /height:\s*36px/);
  assert.match(button, /border-radius:\s*50%/);
});

// A feature stylesheet may keep what is genuinely its own (Orders' bell badges, its
// tablet sizes) but must not give the bar, or its round button, a second look.
test('no feature stylesheet redefines the shape or colour of its own header', () => {
  const offenders = [];
  for (const file of ['orders.css', 'catalogue.css', 'pastries.css', 'foodcost.css', 'inventory.css', 'style.css']) {
    const css = stripComments(read(file));
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selectors = m[1].split(',').map(s => s.trim());
      const isBar = selectors.some(s => /^\.(orders|cat|pas|fc|inv)-header$/.test(s));
      const isButton = selectors.some(s => /^\.(orders|cat|pas|fc|inv)-icon-btn$/.test(s)
        || /^\.(overlay-home-btn|overlay-back-btn|settings-back-btn)$/.test(s));
      if (isBar && /(^|[;\s])(border-radius|background)\s*:/.test(m[2])) offenders.push(`${file}: ${selectors.join(', ')}`);
      if (isButton && /(^|[;\s])(border-radius|background|border|width|height)\s*:/.test(m[2])) offenders.push(`${file}: ${selectors.join(', ')}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the round buttons in the Calculator overlay bars carry the shared class', () => {
  const calculator = read('calculator.html').replace(/<!--[\s\S]*?-->/g, '');
  const bars = calculator.split('class="recipe-overlay-header"').slice(1);
  assert.ok(bars.length >= 13, `only ${bars.length} overlay bars found`);
  const bare = [];
  for (const bar of bars) {
    const body = bar.slice(0, bar.indexOf('</div>'));
    for (const m of body.matchAll(/<(button|a)\s[^>]*class="([^"]*)"/g)) {
      if (!m[2].split(/\s+/).includes('app-icon-btn')) bare.push(m[2]);
    }
  }
  assert.deepEqual(bare, []);
});

test('the Calculator and the Catalogue land on the name the Home card shows', () => {
  const calculator = read('calculator.html');
  assert.match(calculator, /<h1 data-i18n="section\.calculator">/);
  assert.match(calculator, /<p data-i18n="ui\.doughScaling">/);
  assert.doesNotMatch(calculator, /<h1 data-location-title/);
  const main = read('js/catalogue/catalogue-main.js');
  assert.match(main, /setHeader\(\{ title: t\('section\.catalogue'\), sub: '', back: false/);
  // No subtitle on the list: it was cut to «Ricette e scalatur…» at 360px. An empty
  // subtitle must be HIDDEN, or it still holds a line of height under the title.
  assert.match(main, /subEl\.hidden = !sub/);
  assert.match(read('catalogue.html'), /<p id="catSub" hidden><\/p>/);
});

// ⚠️ 29 Sep 2026, measured at 296px: with `min-width: 0` on the SLOTS, the tracks
// shrank below Orders' three buttons, which overflowed leftwards and drew «Ordini»
// UNDER the bell. The title is the one allowed to give way.
test('⚠️ a header slot may never shrink below its buttons', () => {
  const css = stripComments(read('tokens.css'));
  const slot = css.match(/(^|\n)\.app-header-slot\s*\{([^}]*)\}/);
  assert.ok(slot, '.app-header-slot is missing from tokens.css');
  assert.doesNotMatch(slot[2], /min-width:\s*0/);
  const title = css.match(/(^|\n)\.app-header-title\s*\{([^}]*)\}/);
  assert.ok(title, '.app-header-title is missing from tokens.css');
  assert.match(title[2], /min-width:\s*0/, 'the title gives way instead');
});

// Below 360px the subtitle is dropped, not cut: «CONTATTI E ALLERG…» on three screens
// at 296px (ui-check, 29 Sep 2026).
test('below 360px the header subtitle is hidden, on every screen', () => {
  const css = stripComments(read('tokens.css'));
  assert.match(css, /@media \(max-width: 359px\) \{\s*\.app-header-title p \{ display: none; \}\s*\}/);
});
