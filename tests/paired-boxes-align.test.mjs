// A field label can wrap to two lines at 296px. In every two-column row where a label sits
// above a box, the boxes must still share one line: bottom-aligned, so a long label grows
// upward and never pushes its box down (review of 1 Oct 2026).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const ruleOf = (file, selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css(file).match(new RegExp(`(?:^|\\n)${esc} \\{([^}]*)\\}`));
  assert.ok(m, `${selector} missing from ${file}`);
  return m[1];
};

const PAIRS = [
  ['orders.css', '.mgmt-pair', /align-items:\s*end/],
  ['records.css', '.rec-host .mgmt-pair', /align-items:\s*end/],
  ['orders.css', '.alg-nutrition', /align-items:\s*end/],
  ['records.css', '.rec-host .alg-nutrition', /align-items:\s*end/],
  ['catalogue.css', '.cat-loss-pair', /align-items:\s*end/],
  ['foodcost.css', '.fc-weigh-pair', /align-items:\s*end/],
  ['catalogue.css', '.lab-size-custom', /align-items:\s*flex-end/],
];

test('paired boxes under labels are bottom-aligned', () => {
  for (const [file, selector, re] of PAIRS) {
    assert.match(ruleOf(file, selector), re, `${selector} (${file})`);
  }
});
