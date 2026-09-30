// The text colours in tokens.css against the grounds they sit on (P18).
//
// --text-3 shipped at 4.49:1 on --surface — 0.01 under the 4.5:1 small text needs —
// and wore it on ~40 screens (the settings kit, supplier rows, the Home cards) until
// an axe pass caught it on 28 Sep 2026. Nothing looked wrong; the number was.
// This pins the colours as NUMBERS, so a retune of the palette cannot slip under.
//
// --text-4 joined the pinned list on 29 Sep 2026, when Federico chose to darken it
// (it was 3.41:1). --text-5 is placeholder grey and stays unpinned — which is why
// no text somebody has to READ may use it (the last test below).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');
const token = name => {
  const m = css.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})\\b`));
  assert.ok(m, `${name} is not a 6-digit hex in tokens.css`);
  return m[1];
};

// WCAG 2.x relative luminance and contrast ratio.
const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('the contrast formula matches the known values', () => {
  assert.equal(contrast('#000000', '#FFFFFF').toFixed(1), '21.0');
  assert.equal(contrast('#7C7566', '#FFFDF7').toFixed(2), '4.49');   // the colour that failed
});

for (const text of ['--text', '--text-2', '--text-3', '--text-4']) {
  for (const ground of ['--surface', '--surface-2', '--bg']) {
    test(`${text} on ${ground} reaches 4.5:1`, () => {
      const ratio = contrast(token(text), token(ground));
      assert.ok(ratio >= 4.5, `${text} ${token(text)} on ${ground} ${token(ground)} is ${ratio.toFixed(2)}:1`);
    });
  }
}

test('--warn on --warn-bg reaches 4.5:1', () => {
  const ratio = contrast(token('--warn'), token('--warn-bg'));
  assert.ok(ratio >= 4.5, `${ratio.toFixed(2)}:1`);
});

// --text-5 is placeholder grey (2.24:1). The Pastries day names wore it and axe
// flagged them at every size (ui-check, 28 Sep 2026): outside a ::placeholder or an
// icon it is text somebody has to read, and it fails.
test('--text-5 colours only placeholders and icons', () => {
  const sheets = ['tokens.css', 'style.css', 'orders.css', 'catalogue.css', 'foodcost.css',
    'inventory.css', 'pastries.css', 'order.css', 'auth.css'];
  const offenders = [];
  let seen = 0;
  for (const sheet of sheets) {
    const src = readFileSync(new URL(`../${sheet}`, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, sel, body] of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/(^|[^-])color:\s*var\(--(pas-)?text-5\)/.test(body)) continue;
      seen++;
      if (/::placeholder|-icon\b/.test(sel)) continue;
      offenders.push(`${sheet}: ${sel.trim()}`);
    }
  }
  assert.ok(seen >= 3, `only ${seen} uses of --text-5 found — the search is broken`);
  assert.deepEqual(offenders, []);
});

// The «Today» chip on the tablet's supplier rows (ui-check, Italian tablet, 29 Sep 2026):
// pale --on-brand text on --crust measured 3.2:1. It sits on --crust-ink now — pinned as the
// rule it is AND as the number, so neither the rule nor the palette can drift back under.
test('the tablet «Today» chip: pale text on --crust-ink, at least 4.5:1', () => {
  const orders = readFileSync(new URL('../orders.css', import.meta.url), 'utf8');
  const rule = orders.match(/\.supplier-row-day--today \{[^}]*\}/)?.[0] || '';
  assert.match(rule, /background:\s*var\(--crust-ink\)/);
  assert.match(rule, /color:\s*var\(--on-brand\)/);
  assert.ok(contrast(token('--on-brand'), token('--crust-ink')) >= 4.5);
});
