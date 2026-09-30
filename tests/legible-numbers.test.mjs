// The figures in every number box are Atkinson Hyperlegible Next's (Federico, 30 Sep 2026:
// numbers easier to read at the counter). Nothing here can see a glyph; it pins the facts a
// later edit could quietly undo — a face that no longer loads offline, a box that slipped
// back to its old font, a file that grew back to the whole alphabet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const read = (name) => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const TOKENS = read('tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');
const FILE = 'fonts/atkinson-next-digits.woff2';

test('the digits face is declared once, self-hosted, limited to figures', () => {
  const faces = TOKENS.match(/@font-face\s*\{[^}]*'Mise Numbers'[^}]*\}/g) || [];
  assert.equal(faces.length, 1);
  assert.match(faces[0], new RegExp(`src: url\\(${FILE}\\) format\\('woff2'\\)`));
  assert.match(faces[0], /unicode-range: U\+0020, U\+002C, U\+002E, U\+0030-0039;/,
    'only the figures change: letters in the same box stay in Manrope');
  assert.match(faces[0], /font-display: swap/);
});

test('the file is the 4 KB subset, not the whole font', () => {
  const size = statSync(new URL('../' + FILE, import.meta.url)).size;
  assert.ok(size > 1000 && size < 10000, `${FILE} is ${size} bytes`);
});

test('every number box uses it, over any section rule', () => {
  assert.match(TOKENS, /--font-numbers: 'Mise Numbers', 'Manrope',/);
  assert.match(TOKENS,
    /input:is\(\[type="number"\], \[inputmode="decimal"\], \[inputmode="numeric"\]\) \{\s*font-family: var\(--font-numbers\) !important;\s*\}/);
});

test('precached, so it works offline like the other faces', () => {
  assert.match(read('sw.js'), new RegExp(`'\\./${FILE.replace('.', '\\.')}',`));
});
