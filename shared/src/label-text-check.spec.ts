// The allergen check on an image label's text, against the owner's own `controlla_allergeni` (the golden file recorded
// from his script on a FAKE corpus) — the same answer on every product, except the three defects fixed on purpose,
// each pinned here as the one difference it makes.

import { describe, expect, test } from 'vitest';
import { golden } from './fixtures/label-image-golden';
import { BOLD_WORDS, CHECKED_WORDS, checkLabelText, ingredientAt, runsOf } from './label-text-check';

const it = { lang: 'it' } as const;

describe('the allergen check, against the owner’s script', () => {
  const same = golden.products.filter(p => !p.defects.includes('b') && !p.defects.includes('c'));

  test.each(same.map(p => [p.id, p] as const))('%s: the same errors and the same things to verify', (_id, p) => {
    const r = checkLabelText(p.ingredients, it);
    expect(r.available).toBe(true);
    expect(r.errors).toEqual(p.check.errors);
    expect(r.warnings).toEqual(p.check.warnings);
  });

  test('the corpus holds every kind of answer', () => {
    const kinds = new Set(golden.products.flatMap(p => [...p.check.errors, ...p.check.warnings].map(i => i.kind)));
    expect([...kinds].sort()).toEqual(['chocolate', 'hidden', 'lecithin', 'lowercase', 'margarine', 'sulphites']);
  });

  test('(b) «maltodestrina» and «maltitolo» are not malt: the script said ERRORE, the port says nothing', () => {
    const p = golden.products.find(g => g.id === 'malto-sugars');
    expect(p?.check.errors).toEqual([{ kind: 'hidden', word: 'malto' }]);
    expect(checkLabelText(p?.ingredients ?? '', it).errors).toEqual([]);
    // …and real malt still needs its barley.
    expect(checkLabelText('INGREDIENTI: farina, malto, sale.', it).errors).toEqual([{ kind: 'hidden', word: 'malto' }]);
    expect(checkLabelText("INGREDIENTI: farina, estratto di malto d'ORZO, sale.", it).errors).toEqual([]);
  });

  test('(c) ORZO must be in the beer’s own ingredient: the script let ORZO elsewhere cover it, the port does not', () => {
    const p = golden.products.find(g => g.id === 'beer-orzo-elsewhere');
    expect(p?.check.errors).toEqual([]);
    expect(checkLabelText(p?.ingredients ?? '', it).errors).toEqual([{ kind: 'hidden', word: 'birra' }]);
    // Inside a parenthesis, the piece is the one between ITS commas.
    expect(checkLabelText('INGREDIENTI: crema (zucchero, ORZO tostato, birra), sale.', it).errors)
      .toEqual([{ kind: 'hidden', word: 'birra' }]);
    expect(checkLabelText('INGREDIENTI: crema (zucchero, birra con ORZO), sale.', it).errors).toEqual([]);
    // One beer declared and one not is still an error, said once.
    expect(checkLabelText('INGREDIENTI: birra (ORZO), birra scura, sale.', it).errors).toEqual([{ kind: 'hidden', word: 'birra' }]);
  });

  test('«lievito di birra» is a yeast, wherever it stands', () => {
    expect(checkLabelText('INGREDIENTI: farina di GRANO, lievito di birra, sale.', it).errors).toEqual([]);
    expect(checkLabelText('INGREDIENTI: lievito di birra, birra chiara.', it).errors).toEqual([{ kind: 'hidden', word: 'birra' }]);
  });
});

describe('word boundaries are Python’s, not JavaScript’s', () => {
  test('a letter with an accent is part of the word (JS \\b would see a boundary)', () => {
    expect(checkLabelText('caffèlatte, pannacotta, burrocacao', it).errors).toEqual([]);
    expect(/\blatte\b/i.test('caffèlatte')).toBe(true); // what a naive port would have said
  });
  test('so is a digit or an underscore', () => {
    expect(checkLabelText('latte2, _uova', it).errors).toEqual([]);
  });
  test('punctuation and apostrophes are boundaries', () => {
    expect(checkLabelText('d’avena, (soia), burro.', it).errors.map(e => e.kind === 'lowercase' && e.word))
      .toEqual(['avena', 'burro', 'soia']);
  });
});

describe('the cross-check with the recipe', () => {
  test('a declared allergen the text never says in capitals is an ERRORE', () => {
    const r = checkLabelText('INGREDIENTI: farina di GRANO, zucchero.', { lang: 'it', declared: ['gluten-wheat', 'milk', 'eggs'] });
    expect(r.errors).toEqual([{ kind: 'declared-missing', code: 'milk' }, { kind: 'declared-missing', code: 'eggs' }]);
  });
  test('any of its words in capitals is enough', () => {
    const r = checkLabelText('INGREDIENTI: farina di FRUMENTO, BURRO, TUORLO, pecan (NOCI).', {
      lang: 'it', declared: ['gluten-wheat', 'milk', 'eggs', 'nuts-pecan'],
    });
    expect(r.errors).toEqual([]);
  });
  test('in small letters it is not said (and the small letters are their own error)', () => {
    const r = checkLabelText('INGREDIENTI: latte.', { lang: 'it', declared: ['milk'] });
    expect(r.errors).toEqual([{ kind: 'lowercase', word: 'latte' }, { kind: 'declared-missing', code: 'milk' }]);
  });
  test('no declaration (not fully declared): no cross-check', () => {
    expect(checkLabelText('INGREDIENTI: zucchero.', { lang: 'it', declared: null }).errors).toEqual([]);
  });
});

describe('the rest', () => {
  test('labels that are not Italian get no check, and say so', () => {
    expect(checkLabelText('flour, butter', { lang: 'en' })).toEqual({ available: false, errors: [], warnings: [] });
    expect(checkLabelText('farina', { lang: null }).available).toBe(false);
  });

  test('(a) the bold list IS the checked list, longest first', () => {
    expect([...BOLD_WORDS].sort()).toEqual(CHECKED_WORDS.map(w => w.toUpperCase()).sort());
    expect(BOLD_WORDS.indexOf('PISTACCHIO')).toBeLessThan(BOLD_WORDS.indexOf('PISTACCHI'));
    expect(BOLD_WORDS.indexOf('MOLLUSCHI')).toBeLessThan(BOLD_WORDS.indexOf('NOCI'));
  });

  test('runs: a capital allergen anywhere inside a word is bold, the rest plain', () => {
    expect(runsOf('d’AVENA,')).toEqual([{ text: 'd’', bold: false }, { text: 'AVENA', bold: true }, { text: ',', bold: false }]);
    expect(runsOf('PISTACCHIO,')).toEqual([{ text: 'PISTACCHIO', bold: true }, { text: ',', bold: false }]);
    expect(runsOf('avena')).toEqual([{ text: 'avena', bold: false }]);
  });

  test('the ingredient a word belongs to', () => {
    const t = 'INGREDIENTI: farina, birra (contiene ORZO, alcol 5°), sale.';
    expect(ingredientAt(t, t.indexOf('birra'))).toBe(' birra (contiene ORZO, alcol 5°)');
    const n = 'crema (zucchero, birra), sale';
    expect(ingredientAt(n, n.indexOf('birra'))).toBe(' birra');
  });
});
