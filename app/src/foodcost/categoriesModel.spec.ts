import { describe, expect, test } from 'vitest';
import { normalizeProduct } from '@mise/shared/foodcost-model';
import type { Product } from '@mise/shared/foodcost-model';
import { recipeProductId } from '@mise/shared/from-recipes';
import { CAKES_GROUP_ID, cardCategories, groupRows, grouped, isGroupOpen, nextRank, readCategories } from './categoriesModel';

// The pure half of Food cost's categories: reading the category documents, and grouping the cards under the Ricettario's words
// (28 Nov 2026: the words are made in the Ricettario only; a recipe's card follows its recipe, any other card follows the name of
// its category document).

const docs = readCategories([
  { id: 'b', name: 'Bread', rank: 2 }, { id: 'a', name: 'Cakes', rank: 1 }, { id: 'x', name: '  ', rank: 3 }, { id: '', name: 'No id', rank: 4 }, null,
]);
const card = (id: string, categoryId: string | null): Product => normalizeProduct({ id, name: id, categoryId }) as Product;
const rows = (...products: Product[]) => products.map(product => ({ product }));
const recipes = {
  r1: { id: 'r1', name: 'Focaccia', category: 'bread' },
  r2: { id: 'r2', name: 'Torta', category: 'Dolci' },
  r3: { id: 'r3', name: 'Plain' },
  r4: { id: 'r4', name: 'Gone word', category: 'Removed' },
};
const WORDS = ['Pane', 'bread', 'Dolci', 'Cakes'];
const book = cardCategories({ words: WORDS, categories: docs, recipes, locale: 'en' });
const ids = (groups: ReturnType<typeof groupRows<{ product: Product }>>) => groups.map(group => [group.name ?? group.id, group.items.map(row => row.product.id)]);

describe('reading and ordering the category documents', () => {
  test('in the order of the list; a document with no name or no id is dropped; a bad rank counts as 0', () => {
    expect(docs.map(category => category.id)).toEqual(['a', 'b']);
    expect(readCategories([{ id: 'z', name: 'Z', rank: 'x' }, { id: 'y', name: 'Y', rank: 0 }]).map(category => category.id)).toEqual(['y', 'z']);
    expect(readCategories('nonsense')).toEqual([]);
  });

  test('a new category goes after every one there is, even when this phone\'s clock is behind', () => {
    expect(nextRank(docs, 1_000)).toBe(1_000);
    expect(nextRank([{ id: 'a', name: 'A', rank: 5_000 }], 1_000)).toBe(5_001);
  });
});

describe('the groups are the Ricettario\'s words, alphabetical', () => {
  test('in the locale\'s order, case and accents aside', () => {
    expect(book.words).toEqual(['bread', 'Cakes', 'Dolci', 'Pane']);
    expect(cardCategories({ words: ['Zeta', 'àlfa', 'Beta'], categories: [], recipes: {}, locale: 'it' }).words).toEqual(['àlfa', 'Beta', 'Zeta']);
  });
});

describe('a card made from a recipe follows its recipe', () => {
  const list = rows(
    card(recipeProductId('r1'), 'a'), // its stored categoryId points at «Cakes», but the recipe says «bread»: the recipe wins
    card(recipeProductId('r2'), null),
    card(recipeProductId('r3'), 'b'), // the recipe has no category: none, whatever the card says
    card(recipeProductId('r4'), 'b'), // the recipe's word is not on the list: none
    card(recipeProductId('missing'), 'b'), // the recipe is not there at all: none
  );

  test('under the recipe\'s word spelled as the list spells it; no category, an unknown word and a missing recipe go to «No category»', () => {
    expect(ids(groupRows(list, book))).toEqual([
      ['bread', ['recipe-r1']],
      ['Dolci', ['recipe-r2']],
      [null, ['recipe-r3', 'recipe-r4', 'recipe-missing']],
    ]);
  });

  test('moving the recipe moves the card with no card written', () => {
    const moved = cardCategories({ words: WORDS, categories: docs, recipes: { ...recipes, r1: { id: 'r1', name: 'Focaccia', category: 'Pane' } }, locale: 'en' });
    expect(ids(groupRows(rows(card(recipeProductId('r1'), null)), moved))).toEqual([['Pane', ['recipe-r1']]]);
  });

  test('it says it follows the recipe, and only a recipe\'s card does', () => {
    expect(book.followsRecipe({ id: recipeProductId('r1') })).toBe(true);
    expect(book.followsRecipe({ id: 'p1' })).toBe(false);
    expect(book.followsRecipe({ id: 'cake-c1' })).toBe(false);
  });
});

describe('any other card follows the name of its category document', () => {
  const list = rows(card('1', 'b'), card('2', 'a'), card('3', null), card('4', 'gone'), card('5', 'a'));

  test('matched to a word capitals and repeated spaces aside; a stale id and a name that is no word read as none; an empty group is not drawn', () => {
    // «Bread» matches the word «bread»; «Cakes» matches «Cakes».
    expect(ids(groupRows(list, book))).toEqual([['bread', ['1']], ['Cakes', ['2', '5']], [null, ['3', '4']]]);
    // ⚠️ The Ricettario's own fold: accents DO count («Più» and «Piu» are two words there), repeated spaces and capitals do not.
    const accents = cardCategories({ words: ['Più', 'Pane rustico'], categories: [{ id: 'p', name: 'PIU', rank: 1 }, { id: 'q', name: 'Pane  rustico', rank: 2 }], recipes: {}, locale: 'it' });
    expect(accents.wordOf(card('1', 'p'))).toBe('');
    expect(accents.wordOf(card('1', 'q'))).toBe('Pane rustico');
    expect(accents.docOf('pane   RUSTICO')?.id).toBe('q');
    expect(accents.docOf('Pane')).toBeNull();
    const unknown = cardCategories({ words: ['Pane'], categories: docs, recipes: {}, locale: 'en' });
    expect(ids(groupRows(list, unknown))).toEqual([[null, ['1', '2', '3', '4', '5']]]);
  });

  test('finds the document that carries a word, or none', () => {
    expect(book.docOf('BREAD')?.id).toBe('b');
    expect(book.docOf('Pane')).toBeNull();
  });
});

describe('when the Ricettario\'s words cannot be read', () => {
  const fallback = cardCategories({ words: null, categories: docs, recipes, locale: 'en' });

  test('the groups are the names of the category documents, in their own order, for every card', () => {
    expect(fallback.fromRecipeBook).toBe(false);
    expect(fallback.words).toEqual(['Cakes', 'Bread']);
    expect(ids(groupRows(rows(card(recipeProductId('r1'), 'b'), card('2', 'a'), card('3', null)), fallback))).toEqual([
      ['Cakes', ['2']], ['Bread', ['recipe-r1']], [null, ['3']],
    ]);
    expect(fallback.followsRecipe({ id: recipeProductId('r1') })).toBe(false);
  });
});

describe('which groups are open', () => {
  const group = { items: rows(card('1', 'a')) };
  const none = new Set<string>();

  test('all closed to begin with', () => {
    expect(isGroupOpen('a', group, { userOpen: none, searching: false, openProductId: null })).toBe(false);
    expect(isGroupOpen(null, group, { userOpen: none, searching: false, openProductId: null })).toBe(false);
  });

  test('a tap opens one, the open card\'s group opens by itself, and a search opens every group shown', () => {
    expect(isGroupOpen('a', group, { userOpen: new Set(['a']), searching: false, openProductId: null })).toBe(true);
    expect(isGroupOpen(null, group, { userOpen: new Set(['__none__']), searching: false, openProductId: null })).toBe(true);
    expect(isGroupOpen('a', group, { userOpen: none, searching: false, openProductId: '1' })).toBe(true);
    expect(isGroupOpen('a', group, { userOpen: none, searching: false, openProductId: '9' })).toBe(false);
    expect(isGroupOpen('a', group, { userOpen: none, searching: true, openProductId: null })).toBe(true);
  });
});

describe('the «Cakes» group', () => {
  const cake = card('cake-c1', 'a');
  const other = card('p1', 'a');
  const loose = card('p2', null);

  test('every cake card sits in it, whatever category it carries, after the words and before «No category»', () => {
    const groups = groupRows(rows(cake, other, loose), book);
    expect(groups.map(group => group.id)).toEqual(['cakes', CAKES_GROUP_ID, null]);
    expect(groups[0]?.items.map(row => row.product.id)).toEqual(['p1']);
    expect(groups[1]?.items.map(row => row.product.id)).toEqual(['cake-c1']);
  });

  test('the list is grouped only when there is at least one word; a cake alone does not group it', () => {
    expect(grouped(cardCategories({ words: [], categories: docs, recipes: {}, locale: 'en' }))).toBe(false);
    expect(grouped(book)).toBe(true);
    expect(groupRows(rows(loose, cake), book).map(group => group.id)).toEqual([CAKES_GROUP_ID, null]);
  });
});
