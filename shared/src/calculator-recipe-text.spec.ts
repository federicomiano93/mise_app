// Unit tests for the Copy/WhatsApp recipe text builder (P15 — the owner cannot read code), run against BOTH
// implementations: the TypeScript port in shared/ and js/calculator-recipe-text.js, which the live app uses
// today. Ported from tests/calc-recipe-text.test.mjs; the two must stay equal until the switch to Mise 2 —
// EXCEPT on one input, below.
//
// ⚠️ THE ONE DIFFERENCE (decided 12 Oct 2026, written in docs/parity/calculator.md): js/ writes the
// ingredient called exactly `Flour uniqua blue` on TWO lines ("Flour uniqua", then "blue:" with the value) —
// a legacy layout for one venue's ingredient, which is that customer's DATA written into the code. The port
// does not know it and writes the ingredient like every other line. The two tests that used it
// ('output: title…' and '"Flour uniqua blue" becomes two lines…') are therefore split: each runs against
// both files on an ordinary ingredient, and the Flour case is asserted separately, file by file, in the last
// block. Nothing else differs.
//
// calculator-recipe-text.ts is a FULL port, so parity.spec.ts pairs it (same names, same function shapes).
//
// PORTED from tests/calc-recipe-text.test.mjs: all 5 of its tests (two of them adapted as said above).

import { describe, expect, test } from 'vitest';
import * as ported from './calculator-recipe-text';
import * as legacyJs from '../../js/calculator-recipe-text.js';

const legacy = legacyJs as unknown as typeof ported;

const SEP = '-'.repeat(22);

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('output: title (uppercased name), separator and one aligned line per ingredient', () => {
    const rows = [
      { name: 'Flour T65', grams: 1000 },
      { name: 'Yeast', grams: 4 },
    ];
    expect(m.buildRecipeText('Focaccia', rows, 2000)).toBe([
      'FOCACCIA  2.0 kg',
      SEP,
      'Flour T65:  1000 g',
      'Yeast:         4 g',
    ].join('\n'));
  });

  test('a normal ingredient stays one line', () => {
    const single = m.buildRecipeText('Brioche', [{ name: 'Water', grams: 1575 }], 1575);
    expect(single.split('\n').length).toBe(3); // title + separator + one line
  });

  test('grams are rounded the same way the screen rounds them', () => {
    expect(m.buildRecipeText('Brioche', [{ name: 'Yeast', grams: 127.4 }], 3000)).toMatch(/Yeast:\s+127 g/);
    expect(m.buildRecipeText('Brioche', [{ name: 'Yeast', grams: 4.5 }], 3000)).toMatch(/Yeast:\s+5 g/);
  });

  test('total is shown in kg with one decimal; the title is the uppercased recipe name', () => {
    expect(m.buildRecipeText('Focaccia', [{ name: 'X', grams: 1 }], 2500)).toMatch(/^FOCACCIA {2}2\.5 kg/);
    expect(m.buildRecipeText('My New Recipe', [{ name: 'X', grams: 1 }], 1000)).toMatch(/^MY NEW RECIPE {2}1\.0 kg/);
  });

  test('no rows returns an empty string (nothing calculated yet)', () => {
    expect(m.buildRecipeText('Focaccia', [], 2500)).toBe('');
    expect(m.buildRecipeText('Focaccia', null, 2500)).toBe('');
  });
});

// ── The one input on which the two files differ ──────────────────────────────

describe('the ingredient called «Flour uniqua blue»: the one documented difference', () => {
  const rows = [
    { name: 'Flour uniqua blue', grams: 1000 },
    { name: 'Yeast', grams: 4 },
  ];

  test('js/ (current app) splits it onto two lines (a legacy layout for one venue)', () => {
    expect(legacy.buildRecipeText('Focaccia', rows, 2000)).toBe([
      'FOCACCIA  2.0 kg',
      SEP,
      'Flour uniqua',
      'blue:       1000 g',
      'Yeast:         4 g',
    ].join('\n'));
    const lines = legacy.buildRecipeText('Sourdough', [{ name: 'Flour uniqua blue', grams: 500 }], 500).split('\n');
    expect(lines.length).toBe(4); // title + separator + bare label + "blue:" line
    expect(lines[2]).toBe('Flour uniqua');
    expect(lines[3]).toMatch(/^blue:\s+500 g$/);
  });

  test('shared/ (TypeScript) writes it like every other ingredient: no business data in the code', () => {
    expect(ported.buildRecipeText('Focaccia', rows, 2000)).toBe([
      'FOCACCIA  2.0 kg',
      SEP,
      'Flour uniqua blue: 1000 g',
      'Yeast:         4 g',
    ].join('\n'));
    expect(ported.buildRecipeText('Sourdough', [{ name: 'Flour uniqua blue', grams: 500 }], 500).split('\n').length).toBe(3);
  });

  test('…and any other name is written the same by both files (the difference is that one name only)', () => {
    for (const name of ['Flour uniqua', 'blue', 'flour uniqua blue', 'Flour uniqua blue ', 'Flour uniqua blue 2', 'Flour T65', '']) {
      const one = [{ name, grams: 321 }];
      expect(ported.buildRecipeText('R', one, 321), JSON.stringify(name)).toBe(legacy.buildRecipeText('R', one, 321));
    }
  });
});
