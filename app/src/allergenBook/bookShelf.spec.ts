import { describe, expect, it } from 'vitest';
import { bookShelf, chooseShelf } from './bookShelf';

// The allergen book's shelf: who is in it, in what order, and what the pencil screen offers. Invented products only.

type R = { id: string; name: string; category?: string; archived?: true; inBook?: true };
const recipe = (id: string, name: string, extra: Partial<R> = {}): R => ({ id, name, ...extra });
const names = (list: readonly R[]): string[] => list.map(r => r.name);
const everyoneComplete = (): boolean => true;

const CATEGORIES = ['Torte', 'Biscotti', 'Pane'];
const CATALOGUE: R[] = [
  recipe('a', 'Torta della nonna di prova', { category: 'Torte', inBook: true }),
  recipe('b', 'Biscotto test', { category: 'Biscotti', inBook: true }),
  recipe('c', 'Pane prova', { category: 'Pane', inBook: true }),
  recipe('d', 'Altra torta di prova', { category: 'Torte', inBook: true }),
  recipe('e', 'Senza categoria prova', { inBook: true }),
  recipe('f', 'Torta fuori dal libro', { category: 'Torte' }),
  recipe('g', 'Torta archiviata di prova', { category: 'Torte', inBook: true, archived: true }),
];

describe('bookShelf', () => {
  it('holds only the recipes that are in the book and not archived, and counts them', () => {
    const { groups, incomplete, count } = bookShelf(CATALOGUE, CATEGORIES, 'it', everyoneComplete);
    expect(count).toBe(5);
    expect(incomplete).toEqual([]);
    const all = groups.flatMap(group => names(group.recipes));
    expect(all).not.toContain('Torta fuori dal libro');
    expect(all).not.toContain('Torta archiviata di prova');
    expect(all).toHaveLength(5);
  });

  it('follows the Recipe book: categories alphabetical, the recipes in no category last, each group alphabetical by name', () => {
    const { groups } = bookShelf(CATALOGUE, CATEGORIES, 'it', everyoneComplete);
    expect(groups.map(group => group.category)).toEqual(['Biscotti', 'Pane', 'Torte', '']);
    expect(names(groups[2]!.recipes)).toEqual(['Altra torta di prova', 'Torta della nonna di prova']);
    expect(names(groups[3]!.recipes)).toEqual(['Senza categoria prova']);
  });

  it('puts the incomplete products apart, alphabetical, and takes them out of the groups; empty groups are dropped', () => {
    const complete = (r: R): boolean => r.id !== 'b' && r.id !== 'd' && r.id !== 'c';
    const { groups, incomplete, count } = bookShelf(CATALOGUE, CATEGORIES, 'it', complete);
    expect(names(incomplete)).toEqual(['Altra torta di prova', 'Biscotto test', 'Pane prova']);
    expect(groups.map(group => group.category)).toEqual(['Torte', '']);
    expect(names(groups[0]!.recipes)).toEqual(['Torta della nonna di prova']);
    // The count is every product in the book, complete or not.
    expect(count).toBe(5);
  });

  it('keeps a category the venue dropped from its list as «no category»', () => {
    const { groups } = bookShelf(CATALOGUE, ['Torte'], 'it', everyoneComplete);
    expect(groups.map(group => group.category)).toEqual(['Torte', '']);
    expect(names(groups[1]!.recipes)).toEqual(['Biscotto test', 'Pane prova', 'Senza categoria prova']);
  });

  it('is empty for a venue that put nothing in the book', () => {
    expect(bookShelf([recipe('x', 'Pane prova')], CATEGORIES, 'it', everyoneComplete)).toEqual({ groups: [], incomplete: [], count: 0 });
  });

  it('does not mutate what it is given', () => {
    const copy = CATALOGUE.map(r => ({ ...r }));
    bookShelf(CATALOGUE, CATEGORIES, 'it', everyoneComplete);
    expect(CATALOGUE).toEqual(copy);
  });
});

describe('chooseShelf', () => {
  it('offers every recipe that is not archived, in the same order, ticked or not', () => {
    const groups = chooseShelf(CATALOGUE, CATEGORIES, 'it', '');
    expect(groups.map(group => group.category)).toEqual(['Biscotti', 'Pane', 'Torte', '']);
    expect(groups.flatMap(group => names(group.recipes))).not.toContain('Torta archiviata di prova');
    expect(names(groups[2]!.recipes)).toEqual(['Altra torta di prova', 'Torta della nonna di prova', 'Torta fuori dal libro']);
  });

  it('filters by name, ignoring case and spaces around the query, and drops the groups left empty', () => {
    const groups = chooseShelf(CATALOGUE, CATEGORIES, 'it', '  TORTA ');
    expect(groups.map(group => group.category)).toEqual(['Torte']);
    expect(names(groups[0]!.recipes)).toEqual(['Altra torta di prova', 'Torta della nonna di prova', 'Torta fuori dal libro']);
    expect(chooseShelf(CATALOGUE, CATEGORIES, 'it', 'zzz')).toEqual([]);
  });

  it('still leaves the archived out when the query matches them', () => {
    const groups = chooseShelf(CATALOGUE, CATEGORIES, 'it', 'archiviata');
    expect(groups).toEqual([]);
  });
});
