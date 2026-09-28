// The text colours in tokens.css against the grounds they sit on (P18).
//
// --text-3 shipped at 4.49:1 on --surface — 0.01 under the 4.5:1 small text needs —
// and wore it on ~40 screens (the settings kit, supplier rows, the Home cards) until
// an axe pass caught it on 28 Sep 2026. Nothing looked wrong; the number was.
// This pins the colours as NUMBERS, so a retune of the palette cannot slip under.
//
// ⚠️ --text-4 (3.6:1) and --text-5 (placeholders) are deliberately not pinned here:
// --text-4 is an open decision of Federico's, --text-5 is placeholder text.

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

for (const text of ['--text', '--text-2', '--text-3']) {
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
