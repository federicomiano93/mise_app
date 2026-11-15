// recipe-shelf.spec.ts — the recipe shelf: categories and the archive. New in Mise 2 (no original in js/), so nothing is
// paired: these specs are the whole definition.

import { describe, expect, test } from 'vitest';
import {
  RECIPE_CATEGORIES_MAX, RECIPE_CATEGORY_MAX, addCategory, categoryKey, categoryOf, countInCategory, isArchivedRecipe,
  normalizeRecipeCategories, removeCategory, shelfFieldsOf, shelveRecipes, sortedCategories, storedCategoryOf, withoutArchived,
} from './recipe-shelf';

const r = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, ...extra });

describe('the venue\'s list of categories', () => {
  test('keeps only words, trimmed, each once (first spelling wins), folding inner spaces', () => {
    expect(normalizeRecipeCategories([' Natale ', 'natale', 'Estate', '', '  ', 7, null, 'Pane  di  casa', 'ESTATE']))
      .toEqual(['Natale', 'Estate', 'Pane di casa']);
  });
  test('anything that is not a list is no list', () => {
    for (const junk of [undefined, null, 'Natale', 3, { a: 1 }]) expect(normalizeRecipeCategories(junk)).toEqual([]);
  });
  test('never longer than the rules allow', () => {
    const many = Array.from({ length: 150 }, (_, i) => `c${i}`);
    expect(normalizeRecipeCategories(many)).toHaveLength(RECIPE_CATEGORIES_MAX);
  });
  test('sorted for reading, case and accents aside, without touching the stored list', () => {
    const list = ['dolci', 'Estate', 'Àutunno', 'Natale'];
    expect(sortedCategories(list, 'it')).toEqual(['Àutunno', 'dolci', 'Estate', 'Natale']);
    expect(list).toEqual(['dolci', 'Estate', 'Àutunno', 'Natale']);
  });
  test('a word is the same word whatever its case and spaces', () => {
    expect(categoryKey(' Pane  di Casa ')).toBe(categoryKey('pane di casa'));
    expect(categoryKey(3)).toBe('');
  });
});

describe('adding and removing a word', () => {
  test('adds at the end, trimmed', () => {
    expect(addCategory(['Natale'], '  Estate ')).toEqual({ list: ['Natale', 'Estate'] });
  });
  test('refuses an empty word, a long one, one already there (any case), and a full list', () => {
    expect(addCategory([], '   ')).toEqual({ refusal: 'empty' });
    expect(addCategory([], 7)).toEqual({ refusal: 'empty' });
    expect(addCategory([], 'x'.repeat(RECIPE_CATEGORY_MAX + 1))).toEqual({ refusal: 'tooLong' });
    expect(addCategory([], 'x'.repeat(RECIPE_CATEGORY_MAX))).toEqual({ list: ['x'.repeat(RECIPE_CATEGORY_MAX)] });
    expect(addCategory(['Natale'], 'NATALE')).toEqual({ refusal: 'taken' });
    const full = Array.from({ length: RECIPE_CATEGORIES_MAX }, (_, i) => `c${i}`);
    expect(addCategory(full, 'altro')).toEqual({ refusal: 'full' });
  });
  test('removes the word whatever its case, leaving the others in their order', () => {
    expect(removeCategory(['Natale', 'Estate', 'Pane'], 'estate')).toEqual(['Natale', 'Pane']);
    expect(removeCategory(['Natale'], 'Pasqua')).toEqual(['Natale']);
  });
});

describe('a recipe\'s category', () => {
  const list = ['Natale', 'Estate'];
  test('is the list\'s spelling of the word it holds', () => {
    expect(categoryOf(r('a', { category: ' natale' }), list)).toBe('Natale');
  });
  test('a word taken off the list, a missing word and junk read as none', () => {
    expect(categoryOf(r('a', { category: 'Pasqua' }), list)).toBe('');
    expect(categoryOf(r('a'), list)).toBe('');
    expect(categoryOf(r('a', { category: 7 }), list)).toBe('');
    expect(categoryOf(null, list)).toBe('');
  });
  test('the stored word is read as stored (trimmed), on the list or not', () => {
    expect(storedCategoryOf(r('a', { category: ' Pasqua ' }))).toBe('Pasqua');
    expect(storedCategoryOf(r('a', { category: [] }))).toBe('');
  });
});

describe('the archive', () => {
  test('only a literal true is archived', () => {
    expect(isArchivedRecipe(r('a', { archived: true }))).toBe(true);
    for (const value of [false, 'true', 1, null, undefined]) expect(isArchivedRecipe(r('a', { archived: value }))).toBe(false);
    expect(isArchivedRecipe(null)).toBe(false);
  });
  test('the choices for a new link leave the archived recipes out, keeping the order', () => {
    const list = [r('a'), r('b', { archived: true }), r('c', { archived: false })];
    expect(withoutArchived(list).map(x => x.id)).toEqual(['a', 'c']);
  });
});

describe('the fields the store keeps beside the shared shape', () => {
  test('absent rather than empty', () => {
    expect(shelfFieldsOf(r('a'))).toEqual({});
    expect(shelfFieldsOf(r('a', { category: '  ', archived: false }))).toEqual({});
    expect(shelfFieldsOf(r('a', { category: ' Natale ', archived: true }))).toEqual({ category: 'Natale', archived: true });
    expect(shelfFieldsOf('junk')).toEqual({});
  });
});

describe('the list laid out on the shelf', () => {
  test('groups by category in the list\'s order, no category last, archived apart, order kept inside each', () => {
    const recipes = [
      r('p1'), r('e1', { category: 'Estate' }), r('n1', { category: 'natale' }), r('x1', { archived: true, category: 'Natale' }),
      r('e2', { category: 'Estate' }), r('old', { category: 'Pasqua' }), r('x2', { archived: true }),
    ];
    const { groups, archived } = shelveRecipes(recipes, ['Natale', 'Estate', 'Vuota']);
    expect(groups.map(g => [g.category, g.recipes.map(x => x.id)])).toEqual([
      ['Natale', ['n1']],
      ['Estate', ['e1', 'e2']],
      ['', ['p1', 'old']],
    ]);
    expect(archived.map(x => x.id)).toEqual(['x1', 'x2']);
  });
  test('with no category in use, ONE group with no heading: the list as it always was', () => {
    const { groups } = shelveRecipes([r('a'), r('b', { category: 'Gone' })], ['Natale']);
    expect(groups).toEqual([{ category: '', recipes: [r('a'), r('b', { category: 'Gone' })] }]);
  });
  test('nothing to lay out is no group', () => {
    expect(shelveRecipes([], ['Natale'])).toEqual({ groups: [], archived: [] });
  });
  test('counts a word\'s recipes, archived ones included', () => {
    const recipes = [r('a', { category: 'Natale' }), r('b', { category: 'NATALE', archived: true }), r('c', { category: 'Estate' })];
    expect(countInCategory(recipes, 'natale', ['Natale', 'Estate'])).toBe(2);
    expect(countInCategory(recipes, 'Pasqua', ['Natale', 'Estate'])).toBe(0);
    expect(countInCategory(recipes, '', ['Natale'])).toBe(0);
  });
});
