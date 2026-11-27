import { describe, expect, it } from 'vitest';
import { buildLabel, containsLine, mayContainLine } from '@mise/shared/recipe-label-model';
import { bookEntryOf, bookSheetWords, isBookComplete } from './bookEntry';

// One product of the allergen book as words. Invented products and ingredients only. The point of the file: for the same recipe the
// book says EXACTLY what the product label says (name, ingredient line, Contains, May contain), in the venue's country's language.

const STAMP = '2026-01-01';
const INGREDIENTS = new Map<string, unknown>([
  ['flour', { id: 'flour', name: 'Farina di prova', allergens: ['gluten-wheat'], allergensCheckedAt: STAMP }],
  ['milk', { id: 'milk', name: 'Latte di prova', allergens: ['milk'], mayContain: ['nuts-hazelnut'], allergensCheckedAt: STAMP }],
  ['salt', { id: 'salt', name: 'Sale di prova', allergens: [], allergensCheckedAt: STAMP }],
]);
const TABLES = { recipes: new Map<string, unknown>(), ingredients: INGREDIENTS };
const row = (label: string, refId: string | undefined, grams: number) =>
  ({ label, grams, unit: 'g', ...(refId === undefined ? {} : { refId, kind: 'ingredient' }) });

const TORTA = {
  id: 'torta', name: 'Torta della nonna di prova',
  ingredients: [row('Farina di prova', 'flour', 500), row('Latte di prova', 'milk', 300), row('Sale di prova', 'salt', 10)],
};
const IT = { country: 'IT' };
const GB = { country: 'GB' };
const joined = (runs: readonly { text: string }[]): string => runs.map(run => run.text).join('');
const boldWords = (runs: readonly { text: string; bold: boolean }[]): string[] => runs.filter(run => run.bold).map(run => run.text);

describe('a complete product says what its label says', () => {
  it.each([['Italy', IT, 'it'], ['the United Kingdom', GB, 'en']] as const)('in %s: name, line, Contains and May contain are the label’s own', (_, location, lang) => {
    const entry = bookEntryOf(TORTA, TABLES, location);
    const label = buildLabel(TORTA, TABLES, { shows: 'allergens' });
    if (!label.ok) throw new Error('the fixture must make a label');
    expect(entry.complete).toBe(true);
    expect(entry.reason).toBeNull();
    expect(entry.typedText).toBe('none');
    // The recipe's name as written, never upper-cased: on paper capitals mean «allergen».
    expect(entry.name).toBe('Torta della nonna di prova');
    // LabelCard's own join: the names by «, », a full stop at the end.
    expect(joined(entry.runs)).toBe(`${label.ingredients.map(item => item.name).join(', ')}.`);
    expect(entry.contains).toBe(containsLine(label, lang));
    expect(entry.mayContain).toBe(mayContainLine(label, lang));
    expect(entry.contains).not.toBe('');
    expect(entry.mayContain).not.toBe('');
  });

  it('prints the words of the COUNTRY: «Contiene» in Italy, «Contains» in the United Kingdom, whatever the screen’s language', () => {
    const it = bookEntryOf(TORTA, TABLES, IT);
    const en = bookEntryOf(TORTA, TABLES, GB);
    expect(it.ingredientsWord).toBe('Ingredienti');
    expect(it.contains.startsWith('Contiene: ')).toBe(true);
    expect(en.ingredientsWord).toBe('Ingredients');
    expect(en.contains.startsWith('Contains: ')).toBe(true);
    expect(en.mayContain.startsWith('May contain: ')).toBe(true);
  });

  it('makes the emphasised ingredients bold, and only them', () => {
    const entry = bookEntryOf(TORTA, TABLES, IT);
    const label = buildLabel(TORTA, TABLES, { shows: 'allergens' });
    if (!label.ok) throw new Error('the fixture must make a label');
    expect(boldWords(entry.runs)).toEqual(label.ingredients.filter(item => item.emphasise).map(item => item.name));
    expect(boldWords(entry.runs)).toHaveLength(2);
    expect(entry.runs.at(-1)).toEqual({ text: '.', bold: false });
  });

  it('is complete by the same decision as isBookComplete', () => {
    expect(isBookComplete(TORTA, TABLES)).toBe(true);
    expect(isBookComplete({ ...TORTA, ingredients: [...TORTA.ingredients, row('Mistero', undefined, 5)] }, TABLES)).toBe(false);
  });
});

describe('what the person typed', () => {
  const TYPED = 'farina di GRANO, LATTE, sale. Può contenere tracce di NOCCIOLE.';

  it('a typed label name wins over the recipe’s name, trimmed', () => {
    expect(bookEntryOf({ ...TORTA, labelName: '  Torta della nonna  ' }, TABLES, IT).name).toBe('Torta della nonna');
    expect(bookEntryOf({ ...TORTA, labelName: '   ' }, TABLES, IT).name).toBe('Torta della nonna di prova');
  });

  it('a typed ingredients text without errors wins, word by word, the allergens in capitals bold', () => {
    const entry = bookEntryOf({ ...TORTA, labelIngredientsText: TYPED }, TABLES, IT);
    expect(entry.typedText).toBe('used');
    expect(joined(entry.runs)).toBe(TYPED);
    expect(boldWords(entry.runs)).toEqual(['GRANO', 'LATTE', 'NOCCIOLE']);
    // Contains and May contain are still the label's.
    expect(entry.contains).toBe(containsLine(buildLabel(TORTA, TABLES, { shows: 'allergens' }), 'it'));
  });

  it('a typed text with an allergen in small letters is refused, and the composed line is used', () => {
    const entry = bookEntryOf({ ...TORTA, labelIngredientsText: 'farina di grano, LATTE' }, TABLES, IT);
    expect(entry.typedText).toBe('refused');
    expect(joined(entry.runs)).not.toContain('farina di grano');
    expect(joined(entry.runs)).toBe(joined(bookEntryOf(TORTA, TABLES, IT).runs));
  });

  it('a typed text that leaves out a declared allergen is refused too (the cross-check)', () => {
    expect(bookEntryOf({ ...TORTA, labelIngredientsText: 'farina, sale' }, TABLES, IT).typedText).toBe('refused');
  });

  it('for a venue whose labels are not Italian no check exists, so the typed text is NOT used: the composed line is, marked unchecked', () => {
    const entry = bookEntryOf({ ...TORTA, labelIngredientsText: 'flour of grano, milk' }, TABLES, GB);
    expect(entry.typedText).toBe('unchecked');
    expect(joined(entry.runs)).toBe(joined(bookEntryOf(TORTA, TABLES, GB).runs));
    expect(entry.runs.some(run => run.bold)).toBe(true);
  });

  it('a `|` in the typed label name (a line break on the image label) is a single space in the book', () => {
    expect(bookEntryOf({ ...TORTA, labelName: 'Torta | della nonna', }, TABLES, IT).name).toBe('Torta della nonna');
    expect(bookEntryOf({ ...TORTA, labelName: 'Torta|nonna' }, TABLES, IT).name).toBe('Torta nonna');
  });
});

describe('an incomplete product', () => {
  const UNLINKED = {
    id: 'incompleta', name: 'Biscotto test',
    ingredients: [row('Farina di prova', 'flour', 500), row('Zucchero di prova', undefined, 700), row('Uova di prova', undefined, 100), row('Burro di prova', undefined, 100)],
  };

  it('is not complete, names the label’s own reason with the number of rows to fix, and declares nothing', () => {
    const entry = bookEntryOf(UNLINKED, TABLES, IT);
    expect(entry.complete).toBe(false);
    expect(entry.reason).toEqual({ kind: 'not-declared', gaps: 3 });
    expect(entry.contains).toBe('');
    expect(entry.mayContain).toBe('');
    expect(isBookComplete(UNLINKED, TABLES)).toBe(false);
  });

  it('lists the recipe’s own rows as typed, heaviest first, a tie in the recipe’s order, none of them bold', () => {
    const entry = bookEntryOf(UNLINKED, TABLES, IT);
    expect(joined(entry.runs)).toBe('Zucchero di prova, Farina di prova, Uova di prova, Burro di prova.');
    expect(boldWords(entry.runs)).toEqual([]);
  });

  it('says «no weights» when every row is declared but nothing has a weight', () => {
    const entry = bookEntryOf({ id: 'z', name: 'Pane prova', ingredients: [row('Farina di prova', 'flour', 0)] }, TABLES, IT);
    expect(entry.complete).toBe(false);
    expect(entry.reason).toEqual({ kind: 'no-weights' });
  });

  it('says «no weights» for a recipe with no rows at all, and has no line to print', () => {
    const entry = bookEntryOf({ id: 'v', name: 'Pane vuoto di prova', ingredients: [] }, TABLES, IT);
    expect(entry.reason).toEqual({ kind: 'no-weights' });
    expect(entry.runs).toEqual([]);
  });

  it('skips a blank row (somebody half-way through typing)', () => {
    const entry = bookEntryOf({ ...UNLINKED, ingredients: [...UNLINKED.ingredients, row('', undefined, 900)] }, TABLES, IT);
    expect(joined(entry.runs)).toBe('Zucchero di prova, Farina di prova, Uova di prova, Burro di prova.');
  });

  it('a clean typed text wins here too (checked without a cross-check); a bad one is refused and the rows are used', () => {
    expect(bookEntryOf({ ...UNLINKED, labelIngredientsText: 'farina di grano, zucchero' }, TABLES, IT).typedText).toBe('refused');
    const used = bookEntryOf({ ...UNLINKED, labelIngredientsText: 'FARINA, zucchero' }, TABLES, IT);
    expect(used.typedText).toBe('used');
    expect(joined(used.runs)).toBe('FARINA, zucchero');
    expect(used.complete).toBe(false);
    expect(used.contains).toBe('');
  });
});

describe('the paper’s own words follow the venue’s country', () => {
  const TODAY = new Date(2026, 10, 27);

  it('Italian for Italy', () => {
    expect(bookSheetWords(IT, TODAY)).toEqual({
      title: 'Libro allergeni',
      updated: 'Aggiornato al 27/11/2026',
      legend: 'Gli allergeni sono in MAIUSCOLO GRASSETTO.',
      verify: 'Allergeni da verificare: chiedere al personale',
      noCategory: 'Altri prodotti',
    });
  });

  it('English for the United Kingdom, the date day first', () => {
    expect(bookSheetWords(GB, new Date(2026, 0, 5))).toEqual({
      title: 'Allergen book',
      updated: 'Updated on 05/01/2026',
      legend: 'Allergens are in BOLD CAPITALS.',
      verify: 'Allergens to be checked: ask the staff',
      noCategory: 'Other products',
    });
  });

  it('is null without a country, or with one the app does not know: nothing may be printed', () => {
    expect(bookSheetWords({}, TODAY)).toBeNull();
    expect(bookSheetWords(null, TODAY)).toBeNull();
    expect(bookSheetWords({ country: 'FR' }, TODAY)).toBeNull();
  });
});
