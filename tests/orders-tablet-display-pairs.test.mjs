// ⚠️⚠️ THE REVIEW-ROUND BUG, TWICE (28 Sep 2026): a tablet-only control
// (`.order-tools`, then `.supplier-row-spacer`) is unconditionally
// `display: none` OUTSIDE the tablet media query — correct, that half hides
// it on a phone — but with no MATCHING `display:` rule inside the query to
// un-hide it again, so the element could never appear at all, on any screen
// size, whatever `hidden` said. Both shipped past every other test green,
// because sizing rules (`width`, `height`, `flex-shrink`) inside the query
// LOOK like the element is handled there.
//
// This asks the question generically, the same way tests/tablet-width.test.mjs
// asks "is every full-width container capped" once for the whole file instead
// of trusting each new one to remember: every BARE class or id selector
// (no `:pseudo`, no `[attr]`, no ancestor state class — those encode their own
// condition and are a different, unrelated pattern; see body.hide-stock,
// .foo:empty, .foo[hidden] elsewhere in this file) that is unconditionally
// `display: none` OUTSIDE any @media block must have a rule somewhere INSIDE
// the tablet query that sets `display` to something other than `none` for
// that same selector. A new tablet-only control that repeats either half of
// the bug lands here and fails, by name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sheet = (name) => readFileSync(new URL('../' + name, import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// Every `@media (...) { ... }` block, balanced-brace (a regex alone cannot
// tell an inner `}` from the block's own closing one — the same trap
// tests/tablet-width.test.mjs's extractMediaBlocks already avoids).
function mediaBlocks(source) {
  const blocks = [];
  const re = /@media[^{]*\{/g;
  let m;
  while ((m = re.exec(source))) {
    let depth = 1;
    let i = re.lastIndex;
    const start = i;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') depth -= 1;
      i += 1;
    }
    blocks.push({ prelude: m[0], inner: source.slice(start, i - 1), fullMatch: source.slice(m.index, i) });
    re.lastIndex = i;
  }
  return blocks;
}

// A selector that carries no condition of its own: no pseudo-class, no
// attribute, no descendant/ancestor combinator. `.foo:empty`, `.foo[hidden]`
// and `body.hide-stock .foo` all encode WHEN they apply in the selector
// itself and are a different, legitimate pattern — not tablet-only controls.
const BARE_SELECTOR = /^[.#][\w-]+$/;

function bareDisplayNoneSelectors(source) {
  const found = new Set();
  for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selectorList, body] = m;
    if (!/display:\s*none\s*;/.test(body)) continue;
    for (const raw of selectorList.split(',')) {
      const sel = raw.trim();
      if (BARE_SELECTOR.test(sel)) found.add(sel);
    }
  }
  return [...found];
}

// The two halves of one stylesheet: the CSS inside the tablet query, and the rules outside
// any @media block.
function halves(css) {
  const allMediaBlocks = mediaBlocks(css);
  const tabletCss = allMediaBlocks
    .filter((b) => /min-width:\s*900px/.test(b.prelude))
    .map((b) => b.inner)
    .join('\n');
  // Every rule OUTSIDE any @media block — a display:none set inside
  // `@media (max-width: 360px)` or `@media (prefers-reduced-motion: reduce)`
  // is conditional on THAT query, not "always on", and is none of this test's
  // business.
  let outsideCss = css;
  for (const b of allMediaBlocks) outsideCss = outsideCss.replace(b.fullMatch, '');
  return { tabletCss, outsideCss };
}

// Does `tabletCss` carry a rule for this exact token (however it is scoped —
// `body[data-section="orders"] .token`, `.token:not([hidden])`, …) whose
// declaration block sets `display` to something other than `none`?
function shownInsideTabletBlock(tabletCss, token) {
  const escaped = token.replace(/[.#]/, (c) => `\\${c}`);
  const re = new RegExp(`${escaped}(?::[\\w-]+(?:\\([^)]*\\))?)?\\s*\\{([^{}]*)\\}`, 'g');
  let m;
  while ((m = re.exec(tabletCss))) {
    if (/display:\s*(?!none\b)[a-z-]+/i.test(m[1])) return true;
  }
  return false;
}

test('every tablet-only control hidden outside the query is un-hidden inside it', () => {
  const { tabletCss, outsideCss } = halves(sheet('orders.css'));
  const candidates = bareDisplayNoneSelectors(outsideCss);
  // Proves the scan actually finds something, the same discipline every
  // "a scan that matches nothing passes for ever" note in this project asks
  // for (tests/nothing-stays-english.test.mjs, tests/strings-in.mjs).
  assert.ok(candidates.length >= 4,
    `expected several unconditional display:none selectors in orders.css, found ${candidates.length} — the scan itself may be broken`);

  const missing = candidates.filter((sel) => !shownInsideTabletBlock(tabletCss, sel));
  assert.deepEqual(missing, [],
    'these are unconditionally display:none on a phone but no rule inside the tablet '
    + 'media query ever sets display to anything else for them — the element can never '
    + 'appear at all, on any screen size:\n  ' + missing.join('\n  '));
});

// The same rule for tokens.css, where the generic two-pane split lives (suppliers.html's
// #registry-pane is hidden on a phone and shown by the tablet block).
test('tokens.css: the split pane hidden on a phone is shown inside the tablet query', () => {
  const { tabletCss, outsideCss } = halves(sheet('tokens.css'));
  const candidates = bareDisplayNoneSelectors(outsideCss);
  assert.ok(candidates.includes('.app-split-pane'),
    'expected .app-split-pane to be display:none outside the tablet query — the scan itself may be broken');
  const missing = candidates.filter((sel) => !shownInsideTabletBlock(tabletCss, sel));
  assert.deepEqual(missing, [], 'display:none on a phone with no tablet display rule:\n  ' + missing.join('\n  '));
});
