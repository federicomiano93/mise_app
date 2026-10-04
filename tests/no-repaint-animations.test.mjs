// Animations on a weak tablet GPU: only transform and opacity may move for free.
// `transition: all` animates whatever happens to change (layout and paint properties
// included), and an @keyframes on box-shadow, width or height repaints or re-lays-out the
// element on every frame — for an infinite animation, for as long as the screen is open.
// catalogue.css's due-timer pulse and the Orders progress bar both did, and were rewritten
// to a pseudo-element ring and a translateX; this keeps the pattern from coming back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cssFiles = readdirSync(ROOT).filter((f) => f.endsWith('.css'));

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// The body of every @keyframes block, found by balancing braces (the blocks nest).
export function keyframeBlocks(css) {
  const blocks = [];
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    blocks.push({ name: m[1], body: css.slice(re.lastIndex, i - 1) });
  }
  return blocks;
}

test('there are stylesheets to check', () => {
  assert.ok(cssFiles.length >= 5);
  assert.ok(cssFiles.includes('catalogue.css'));
});

test('no stylesheet uses `transition: all`', () => {
  const bad = cssFiles.filter((f) => /transition\s*:[^;}]*\ball\b/.test(stripComments(readFileSync(join(ROOT, f), 'utf8'))));
  assert.deepEqual(bad, []);
});

test('no @keyframes animates box-shadow, width or height', () => {
  const bad = [];
  let seen = 0;
  for (const file of cssFiles) {
    for (const { name, body } of keyframeBlocks(stripComments(readFileSync(join(ROOT, file), 'utf8')))) {
      seen += 1;
      if (/(?:^|[;{\s])(?:box-shadow|width|height|min-width|max-width|min-height|max-height)\s*:/.test(body)) {
        bad.push(`${file}: ${name}`);
      }
    }
  }
  assert.ok(seen >= 3, 'the keyframes parser found nothing — has the guard stopped looking?');
  assert.deepEqual(bad, []);
});

test('the guard sees an animated box-shadow', () => {
  const sample = '@keyframes x { 0% { box-shadow: 0 0 0 0 red; } 50% { opacity: 1; } }';
  const [{ body }] = keyframeBlocks(sample);
  assert.match(body, /box-shadow\s*:/);
});

test('the Orders progress fill slides with a transform instead of animating width', () => {
  const css = stripComments(readFileSync(join(ROOT, 'orders.css'), 'utf8'));
  const rule = /\.progress-fill\s*\{([^}]*)\}/.exec(css)[1];
  assert.match(rule, /transition:\s*transform/);
  assert.doesNotMatch(rule, /transition:[^;]*width/);
  for (const file of ['js/orders/ingredients.js', 'js/orders/suppliers.js']) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    assert.match(src, /translateX\(\$\{/, file);
    assert.doesNotMatch(src, /progress-fill[^\n]*\n?[^\n]*style\.width/, file);
  }
});
