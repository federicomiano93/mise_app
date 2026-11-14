// The ingredient book (Mise 2 only, 14 Nov 2026): where each ingredient is used. No original in js/, so this runs against the
// TypeScript file alone (see the header of ingredient-usage.ts).
import { describe, expect, test } from 'vitest';
import { ingredientBook, searchBook } from './ingredient-usage';

const INGREDIENTS = [
  { id: 'butter', name: 'Burro Elle&Vire 82%', shortName: 'Butter' },
  { id: 'flour', name: 'Flour T45' },
  { id: 'sugar', name: 'Sugar', invoiceName: 'ZUCCHERO SEMOLATO KG 25' },
  { id: 'salt', name: 'Sea salt', active: false },
  { id: 'box', name: 'Cake box', kind: 'packaging' },
];
const RECIPES = [
  { id: 'brioche', name: 'Brioche', ingredients: [
    { label: 'Flour', grams: 2000, unit: 'g', kind: 'ingredient', refId: 'flour' },
    { label: 'Butter', grams: 800, unit: 'g', kind: 'ingredient', refId: 'butter' },
    { label: 'Sugar', grams: 0.8, unit: 'kg', kind: 'ingredient', refId: 'sugar' },
    { label: 'Cream', grams: 300, unit: 'g', kind: 'recipe', refId: 'cream' },
  ] },
  { id: 'cream', name: 'Cream', ingredients: [
    { label: 'Butter', grams: 200, unit: 'g', kind: 'ingredient', refId: 'butter' },
    { label: 'Sugar', grams: 100, unit: 'g', kind: 'ingredient', refId: 'sugar' },
    { label: 'Butter (to finish)', grams: 20, unit: 'g', kind: 'ingredient', refId: 'butter' },
  ] },
  { id: 'old', name: 'Apple tart', archived: true, ingredients: [
    { label: 'Butter', grams: 150, unit: 'g', kind: 'ingredient', refId: 'butter' },
  ] },
  // A row typed by name and never linked: not matched, even though the words are the same.
  { id: 'typed', name: 'Shortbread', ingredients: [{ label: 'Butter', grams: 400, unit: 'g' }] },
];

describe('ingredientBook', () => {
  const book = ingredientBook(RECIPES, INGREDIENTS);
  const entry = (id: string) => book.find(e => e.id === id)!;

  test('every food ingredient, by the name a person reads, alphabetically; packaging is left out', () => {
    expect(book.map(e => e.name)).toStrictEqual(['Butter', 'Flour T45', 'Sea salt', 'Sugar']);
    expect(book.find(e => e.id === 'box')).toBeUndefined();
  });

  test('each recipe that uses it, with every row in its own unit as written (the base recipe)', () => {
    expect(entry('sugar').uses).toStrictEqual([
      { recipeId: 'brioche', recipeName: 'Brioche', archived: false, rows: [{ amount: 0.8, unit: 'kg' }] },
      { recipeId: 'cream', recipeName: 'Cream', archived: false, rows: [{ amount: 100, unit: 'g' }] },
    ]);
  });

  test('a recipe listing the ingredient twice is one recipe with two rows', () => {
    expect(entry('butter').uses.find(u => u.recipeId === 'cream')!.rows).toStrictEqual([{ amount: 200, unit: 'g' }, { amount: 20, unit: 'g' }]);
  });

  test('archived recipes come after the ones in use; each group by name', () => {
    expect(entry('butter').uses.map(u => [u.recipeName, u.archived])).toStrictEqual([['Brioche', false], ['Cream', false], ['Apple tart', true]]);
  });

  test('⚠️ only LINKED rows count: a row typed «Butter» and never linked is not this ingredient', () => {
    expect(entry('butter').uses.map(u => u.recipeId)).not.toContain('typed');
  });

  test('⚠️ direct uses only: a sub-recipe row lists the sub-recipe, not the recipe it is inside', () => {
    // Butter is in the cream and the cream is in the brioche: the brioche is listed for its OWN butter row only.
    expect(entry('butter').uses.find(u => u.recipeId === 'brioche')!.rows).toStrictEqual([{ amount: 800, unit: 'g' }]);
  });

  test('an ingredient no recipe uses is still in the book, with no uses; «not in use» is said', () => {
    expect(entry('salt')).toStrictEqual({ id: 'salt', name: 'Sea salt', inactive: true, uses: [] });
    expect(entry('flour').inactive).toBe(false);
  });

  test('the order follows the interface language, accents and case folded', () => {
    const names = ingredientBook([], [{ id: 'a', name: 'Zucchero' }, { id: 'b', name: 'éclair mix' }, { id: 'c', name: 'Farina 2' }, { id: 'd', name: 'Farina 10' }], 'it')
      .map(e => e.name);
    expect(names).toStrictEqual(['éclair mix', 'Farina 2', 'Farina 10', 'Zucchero']);
  });

  test('odd inputs: no throw, nothing invented', () => {
    for (const odd of [null, undefined, 5, 'x', {}]) {
      expect(ingredientBook(odd as never, odd as never)).toStrictEqual([]);
    }
    expect(ingredientBook([null, 5, { name: 'no id', ingredients: [] }, { id: '', ingredients: [] }], [null, 'x', { name: 'no id' }, { id: '' }])).toStrictEqual([]);
    // A link to an ingredient that is not there is simply not shown.
    expect(ingredientBook([{ id: 'r', name: 'R', ingredients: [{ label: 'Gone', grams: 5, kind: 'ingredient', refId: 'gone' }] }], [])).toStrictEqual([]);
    // A junk amount reads 0, never NaN.
    const junk = ingredientBook([{ id: 'r', name: 'R', ingredients: [{ label: 'B', grams: 'abc', kind: 'ingredient', refId: 'b' }] }], [{ id: 'b', name: 'B' }]);
    expect(junk[0]!.uses[0]!.rows).toStrictEqual([{ amount: 0, unit: 'g' }]);
  });
});

describe('searchBook', () => {
  const book = ingredientBook(RECIPES, INGREDIENTS);

  test('finds an ingredient by any of its three names, folded for case and accents', () => {
    expect(searchBook(book, INGREDIENTS, 'butt').map(e => e.id)).toStrictEqual(['butter']);
    expect(searchBook(book, INGREDIENTS, 'elle&vire').map(e => e.id)).toStrictEqual(['butter']);
    expect(searchBook(book, INGREDIENTS, 'semolato').map(e => e.id)).toStrictEqual(['sugar']);
    expect(searchBook(book, INGREDIENTS, 'SEA').map(e => e.id)).toStrictEqual(['salt']);
    expect(searchBook(ingredientBook([], [{ id: 'p', name: 'Però' }]), [{ id: 'p', name: 'Però' }], 'pero').map(e => e.id)).toStrictEqual(['p']);
  });

  test('an empty search keeps the very same list; no match is an empty list', () => {
    expect(searchBook(book, INGREDIENTS, '  ')).toBe(book);
    expect(searchBook(book, INGREDIENTS, null)).toBe(book);
    expect(searchBook(book, INGREDIENTS, 'zzz')).toStrictEqual([]);
  });
});
