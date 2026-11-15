// «Add a recipe» offers the recipe book's recipes first (item 37 of docs/mise2-port-owed.md; current app a221c160,
// 56864739; tests/calculator-add-from-catalogue.test.mjs, the pure half), and a leavening picked on a keyless row
// (262efcfe). Run against BOTH files: the TypeScript port in shared/ and js/calculator-recipe-source.js.

import { describe, expect, test } from 'vitest';
import * as ported from './calculator-recipe-source';
import * as legacyJs from '../../js/calculator-recipe-source.js';

const legacy = legacyJs as unknown as typeof ported;

type Loose = any;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s — the recipes «Add a recipe» offers', (_name, m) => {
  const { catalogueChoices, rowsToStamp } = m as unknown as Record<string, Loose>;

  test('the book\'s recipes by name, an unnamed one last, each marked when the calculator already has it', () => {
    const book = [
      { id: 'c2', name: 'Pane' }, { id: 'c1', name: '  focaccia ' }, { id: 'c9', name: '' }, { id: 'c3', name: 'Brioche 10' },
      { id: 'c4', name: 'Brioche 2' },
    ];
    const choices = catalogueChoices(book, [{ id: 'r-1', catalogueId: 'c2' }, { id: 'cat-c1' }, { id: 'r-2' }]);
    expect(choices.map((c: Loose) => c.name)).toEqual(['Brioche 2', 'Brioche 10', 'focaccia', 'Pane', '']);
    expect(Object.fromEntries(choices.map((c: Loose) => [c.id, c.used]))).toEqual({ c2: true, c1: true, c9: false, c3: false, c4: false });
  });

  test('⚠️ marked, never hidden: a recipe already in the calculator is still offered', () => {
    expect(catalogueChoices([{ id: 'c1', name: 'Pane' }], [{ id: 'r', catalogueId: 'c1' }])).toEqual([{ id: 'c1', name: 'Pane', used: true }]);
  });

  test('a recipe with no id cannot be linked, so it is not offered; garbage in gives an empty list', () => {
    expect(catalogueChoices([{ name: 'No id' }, null, { id: '  ', name: 'Blank id' }], [])).toEqual([]);
    expect(catalogueChoices(null, null)).toEqual([]);
    expect(catalogueChoices(undefined, undefined)).toEqual([]);
  });

  test('⚠️ rowsToStamp: null when every row already has its id, and then nothing is written back', () => {
    const rows = [{ label: 'Flour', grams: 1, rid: 'a-1' }, { label: 'Water', grams: 2, rid: 'a-2' }];
    expect(rowsToStamp(rows)).toBeNull();
    expect(rowsToStamp([])).toBeNull();
    expect(rowsToStamp(null)).toBeNull();
    expect(rowsToStamp(undefined)).toBeNull();
  });

  test('rowsToStamp: a row without an id gets one, the rows that had one keep the very same object', () => {
    const kept = { label: 'Flour', grams: 1, rid: 'a-1' };
    const bare = { label: 'Water', grams: 2 };
    const stamped = rowsToStamp([kept, bare]) as Loose[];
    expect(stamped).toHaveLength(2);
    expect(stamped[0]).toBe(kept);
    expect(stamped[1]).not.toBe(bare);
    expect(stamped[1].label).toBe('Water');
    expect(typeof stamped[1].rid).toBe('string');
    expect(stamped[1].rid).not.toBe('');
    expect(bare).not.toHaveProperty('rid');
  });
});

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s — a leavening picked on a keyless row', (_name, m) => {
  const chooseLeavening = m.chooseLeavening as (recipe: unknown, value: unknown, linkedRows: null) => boolean;

  test('⚠️ it gets a key no other row has («name-<index>» may belong to an older row once rows move around)', () => {
    const recipe: Loose = { ingredients: [{ key: 'flour', label: 'Flour', grams: 1000 }, { key: 'yeast-2', label: 'Old', grams: 9 }, { key: '', label: 'Yeast', grams: 20 }] };
    expect(chooseLeavening(recipe, '#2', null)).toBe(true);
    expect(recipe.leaveningKey).not.toBe('yeast-2');
    expect(recipe.ingredients[2].key).toBe(recipe.leaveningKey);
    expect(recipe.ingredients.filter((i: Loose) => i.key === recipe.leaveningKey)).toHaveLength(1);
  });

  test('with no clash the key is the name and the position, as before', () => {
    const recipe: Loose = { ingredients: [{ key: 'flour', label: 'Flour', grams: 1000 }, { key: '', label: 'Dry Yeast', grams: 20 }] };
    chooseLeavening(recipe, '#1', null);
    expect(recipe.ingredients[1].key).toBe('dry-yeast-1');
  });
});
