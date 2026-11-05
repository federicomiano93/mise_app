import { describe, expect, it } from 'vitest';
import { normalizeCatalogueRecipe } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import {
  NAME_MAX_LENGTH, addRow, cleanWorking, dropWorkingRow, duplicateWorking, linkRowTo, moveWorkingRow, netWeightText, notWeighedCount, removeRow, setRowFields, shelfLifeText, stepWorkingRow, totalText, workingFrom, workingFromDraft, restoreWorking, setCategory,
} from './editorModel';

// The editor's working copy and the rules that turn it into what is saved (the pure half of catalogue-editor.js).

const recipe = (fields: Record<string, unknown> = {}): CatalogueRecipe => {
  const made = normalizeCatalogueRecipe({
    id: 'r1',
    name: 'Focaccia',
    ingredients: [
      { label: 'Flour', grams: 1000, unit: 'g', kind: 'ingredient', refId: 'ing-1', rid: 'row-a' },
      { label: 'Salt', grams: 0, unit: 'to taste' },
    ],
    lossPct: 12,
    steps: [{ text: 'Mix' }],
    ...fields,
  });
  if (!made) throw new Error('no recipe');
  return made;
};

describe('the working copy', () => {
  it('starts a new recipe empty: no name, one empty row in grams', () => {
    const working = workingFrom(null);
    expect(working.name).toBe('');
    expect(working.rows.map(item => item.row)).toEqual([{ label: '', grams: '', unit: 'g' }]);
    expect(working.rest).toEqual({});
  });

  it('⚠️ keeps everything a row carries — its link and its row id — and everything the recipe carries beside its rows', () => {
    const working = workingFrom(recipe());
    expect(working.rows[0]?.row).toMatchObject({ label: 'Flour', kind: 'ingredient', refId: 'ing-1', rid: 'row-a', unit: 'g' });
    expect(working.rest).toMatchObject({ id: 'r1', lossPct: 12, steps: [{ text: 'Mix' }] });
    expect(working.rest).not.toHaveProperty('name');
    expect(working.rest).not.toHaveProperty('ingredients');
  });

  it('gives every row a key of its own, and a new row a new one', () => {
    const working = addRow(workingFrom(recipe()));
    const keys = working.rows.map(item => item.key);
    expect(new Set(keys).size).toBe(3);
  });

  it('empties the last row instead of removing it, and removes any other', () => {
    const two = workingFrom(recipe());
    const [first, second] = two.rows;
    expect(removeRow(two, first!.key).rows.map(item => item.key)).toEqual([second!.key]);
    const one = removeRow(two, first!.key);
    const emptied = removeRow(one, second!.key);
    expect(emptied.rows).toHaveLength(1);
    expect(emptied.rows[0]?.row).toEqual({ label: '', grams: '', unit: 'g' });
  });

  it('⚠️ hides «to taste» without clearing the number: changing the unit changes only the unit', () => {
    const working = workingFrom(recipe());
    const key = working.rows[0]!.key;
    const taste = setRowFields(working, key, { unit: 'to taste' });
    expect(taste.rows[0]?.row).toMatchObject({ unit: 'to taste', grams: 1000 });
    expect(setRowFields(taste, key, { unit: 'kg' }).rows[0]?.row).toMatchObject({ unit: 'kg', grams: 1000 });
  });
});

describe('cleaning before save', () => {
  it('trims the name and the labels, makes the amounts non-negative numbers and drops the rows with no name', () => {
    let working = workingFrom(null);
    working = { ...working, name: '  Pane  ' };
    working = setRowFields(working, working.rows[0]!.key, { label: '  Farina ', grams: '-5' });
    working = addRow(working);
    working = setRowFields(working, working.rows[1]!.key, { label: '   ', grams: '10' });
    working = addRow(working);
    working = setRowFields(working, working.rows[2]!.key, { label: 'Acqua', grams: 'abc', unit: 'ml' });
    const clean = cleanWorking(working);
    expect(clean.name).toBe('Pane');
    expect(clean.ingredients).toEqual([
      { label: 'Farina', grams: 0, unit: 'g' },
      { label: 'Acqua', grams: 0, unit: 'ml' },
    ]);
  });

  it('⚠️ keeps a row’s link, its row id and the recipe’s other fields', () => {
    const clean = cleanWorking(workingFrom(recipe())) as unknown as Record<string, unknown>;
    expect(clean.id).toBe('r1');
    expect(clean.lossPct).toBe(12);
    expect(clean.steps).toEqual([{ text: 'Mix' }]);
    expect(clean.ingredients).toEqual([
      { label: 'Flour', grams: 1000, unit: 'g', kind: 'ingredient', refId: 'ing-1', rid: 'row-a' },
      { label: 'Salt', grams: 0, unit: 'to taste' },
    ]);
  });

  it('⚠️ lets a net weight nobody touched go through as it is stored — 12.5 g is not rounded to 13 by saving', () => {
    const working = workingFrom(recipe({ netWeightG: 12.5, shelfLifeDays: 4 }));
    const clean = cleanWorking(working) as unknown as Record<string, unknown>;
    expect(clean.netWeightG).toBe(12.5);
    expect(clean.shelfLifeDays).toBe(4);
    expect(netWeightText(working)).toBe('13');
    expect(shelfLifeText(working)).toBe('4');
  });

  it('⚠️ takes an emptied shelf life as «nobody has said» — the key is gone, never 0 — and an emptied net weight as 0', () => {
    const working = { ...workingFrom(recipe({ netWeightG: 250, shelfLifeDays: 4 })), netWeight: '', shelfLife: '' };
    const clean = cleanWorking(working) as unknown as Record<string, unknown>;
    expect(clean).not.toHaveProperty('shelfLifeDays');
    expect(clean.netWeightG).toBe(0);
    expect(shelfLifeText(working)).toBe('');
  });

  it('takes a typed shelf life as whole days', () => {
    const working = { ...workingFrom(null), shelfLife: '7' };
    expect((cleanWorking(working) as unknown as Record<string, unknown>).shelfLifeDays).toBe(7);
    expect(shelfLifeText(working)).toBe('7');
  });
});

describe('the total', () => {
  it('adds the weighable rows in whole grams, with no thousands separator, and counts the rest as not weighed', () => {
    let working = workingFrom(null);
    working = setRowFields(working, working.rows[0]!.key, { label: 'Flour', grams: '1.5', unit: 'kg' });
    working = addRow(working);
    working = setRowFields(working, working.rows[1]!.key, { label: 'Eggs', grams: '3', unit: 'pcs' });
    working = addRow(working);
    working = setRowFields(working, working.rows[2]!.key, { label: 'Salt', grams: '0.4', unit: 'g' });
    const clean = cleanWorking(working);
    expect(totalText(clean)).toBe('1500');
    expect(notWeighedCount(clean)).toBe(1);
  });

  it('leaves the rows with no name out of both', () => {
    let working = workingFrom(null);
    working = setRowFields(working, working.rows[0]!.key, { grams: '500', unit: 'pcs' });
    expect(totalText(cleanWorking(working))).toBe('0');
    expect(notWeighedCount(cleanWorking(working))).toBe(0);
  });
});

describe('linking a row', () => {
  const INGREDIENTS = { 'ing-1': { id: 'ing-1', name: 'Farina 00 Caputo', shortName: 'Caputo' } };
  const RECIPES = [{ id: 'sub', name: 'Pizza base' }];

  const typed = () => {
    const working = workingFrom(null);
    const key = working.rows[0]!.key;
    return { working: setRowFields(working, key, { label: 'flour', grams: '100', rid: 'row-1' }), key };
  };

  it('⚠️ writes the link and sets the name to the item’s display name, on a COPY of the row', () => {
    const { working, key } = typed();
    const before = working.rows[0]!.row;
    const next = linkRowTo(working, key, { kind: 'ingredient', refId: 'ing-1', name: 'Farina 00 Caputo' }, INGREDIENTS, RECIPES);
    expect(next.rows[0]!.row).toMatchObject({ label: 'Caputo', kind: 'ingredient', refId: 'ing-1', grams: '100', rid: 'row-1' });
    expect(before).toEqual({ label: 'flour', grams: '100', unit: 'g', rid: 'row-1' });
    expect(next.rows[0]!.key).toBe(key);
  });

  it('keeps a name typed since when the very same link is chosen again', () => {
    const { working, key } = typed();
    const chosen = { kind: 'ingredient' as const, refId: 'ing-1', name: 'Farina 00 Caputo' };
    const linked = linkRowTo(working, key, chosen, INGREDIENTS, RECIPES);
    const renamed = setRowFields(linked, key, { label: 'my own words' });
    expect(linkRowTo(renamed, key, chosen, INGREDIENTS, RECIPES).rows[0]!.row.label).toBe('my own words');
  });

  it('removes the link and keeps the name', () => {
    const { working, key } = typed();
    const linked = linkRowTo(working, key, { kind: 'recipe', refId: 'sub', name: 'Pizza base' }, INGREDIENTS, RECIPES);
    expect(linked.rows[0]!.row).toMatchObject({ label: 'Pizza base', kind: 'recipe', refId: 'sub' });
    const removed = linkRowTo(linked, key, null, INGREDIENTS, RECIPES).rows[0]!.row;
    expect(removed).not.toHaveProperty('refId');
    expect(removed).not.toHaveProperty('kind');
    expect(removed.label).toBe('Pizza base');
  });
});

describe('reordering the rows', () => {
  const four = () => workingFrom(recipe({
    ingredients: [
      { label: 'A', grams: 1, unit: 'g', kind: 'ingredient', refId: 'ing-1', rid: 'row-a' },
      { label: 'B', grams: 2, unit: 'g', rid: 'row-b' },
      { label: 'C', grams: 3, unit: 'g' },
      { label: 'D', grams: 4, unit: 'g', rid: 'row-d' },
    ],
  }));
  const labels = (working: ReturnType<typeof four>) => working.rows.map(item => item.row.label);
  const keyOf = (working: ReturnType<typeof four>, label: string) => working.rows.find(item => item.row.label === label)!.key;

  it('⚠️ moves the SAME row objects: the link and the row id are the very ones the row had', () => {
    const working = four();
    const before = new Map(working.rows.map(item => [item.row.label, item]));
    const moved = moveWorkingRow(working, 0, 2);
    expect(labels(moved)).toEqual(['B', 'C', 'A', 'D']);
    for (const item of moved.rows) expect(item).toBe(before.get(item.row.label));
    expect(moved.rows[2]!.row).toMatchObject({ kind: 'ingredient', refId: 'ing-1', rid: 'row-a' });
    expect(moved.rest).toBe(working.rest);
    expect(moved.name).toBe(working.name);
  });

  it('gives back the very same working copy when nothing would move', () => {
    const working = four();
    expect(moveWorkingRow(working, 1, 1)).toBe(working);
    expect(moveWorkingRow(working, -1, 2)).toBe(working);
    expect(moveWorkingRow(working, 0, 4)).toBe(working);
    expect(moveWorkingRow(working, 4, 0)).toBe(working);
    expect(stepWorkingRow(working, keyOf(working, 'A'), -1)).toBe(working);
    expect(stepWorkingRow(working, keyOf(working, 'D'), 1)).toBe(working);
    expect(stepWorkingRow(working, 99999, 1)).toBe(working);
  });

  it('steps a row one place up or down', () => {
    const working = four();
    expect(labels(stepWorkingRow(working, keyOf(working, 'B'), -1))).toEqual(['B', 'A', 'C', 'D']);
    expect(labels(stepWorkingRow(working, keyOf(working, 'C'), 1))).toEqual(['A', 'B', 'D', 'C']);
  });

  it('translates a drop BEFORE a row, at both ends and in both directions', () => {
    const working = four();
    const drop = (moved: string, target: string) => labels(dropWorkingRow(working, keyOf(working, moved), keyOf(working, target), 'before'));
    expect(drop('D', 'A')).toEqual(['D', 'A', 'B', 'C']);
    expect(drop('A', 'D')).toEqual(['B', 'C', 'A', 'D']);
    expect(drop('D', 'B')).toEqual(['A', 'D', 'B', 'C']);
    expect(drop('B', 'D')).toEqual(['A', 'C', 'B', 'D']);
  });

  it('translates a drop AFTER a row, at both ends and in both directions', () => {
    const working = four();
    const drop = (moved: string, target: string) => labels(dropWorkingRow(working, keyOf(working, moved), keyOf(working, target), 'after'));
    expect(drop('A', 'D')).toEqual(['B', 'C', 'D', 'A']);
    expect(drop('D', 'A')).toEqual(['A', 'D', 'B', 'C']);
    expect(drop('A', 'B')).toEqual(['B', 'A', 'C', 'D']);
    expect(drop('C', 'B')).toEqual(['A', 'B', 'C', 'D']);
  });

  it('does nothing for a drop on the row itself, next to its own place, «on» a row or at a row that is gone', () => {
    const working = four();
    const a = keyOf(working, 'A');
    const b = keyOf(working, 'B');
    const c = keyOf(working, 'C');
    expect(dropWorkingRow(working, b, b, 'before')).toBe(working);
    expect(dropWorkingRow(working, b, c, 'before')).toBe(working);
    expect(dropWorkingRow(working, b, a, 'after')).toBe(working);
    expect(dropWorkingRow(working, a, c, 'on')).toBe(working);
    expect(dropWorkingRow(working, a, 99999, 'after')).toBe(working);
    expect(dropWorkingRow(working, 99999, a, 'before')).toBe(working);
  });

  it('saves the new order, each row with its link and row id', () => {
    const working = four();
    const moved = dropWorkingRow(working, keyOf(working, 'D'), keyOf(working, 'A'), 'before');
    expect(cleanWorking(moved).ingredients.map(row => [row.label, row.rid, row.refId])).toEqual([
      ['D', 'row-d', undefined], ['A', 'row-a', 'ing-1'], ['B', 'row-b', undefined], ['C', undefined, undefined],
    ]);
  });
});

describe('the working copy of a recipe read from a photograph (step 3d-9)', () => {
  const draft = { name: 'Pane toscano', ingredients: [{ label: 'Flour', grams: 1000, unit: 'g' }, { label: 'Salt', grams: 20 }], netWeightG: 500, shelfLifeDays: 3 };

  it('is a NEW recipe: the name, the rows (the unit read as the recipe screen reads it) and the two label fields', () => {
    const working = workingFromDraft(draft);
    expect(working.name).toBe('Pane toscano');
    expect(working.rows.map(item => item.row)).toEqual([
      { label: 'Flour', grams: 1000, unit: 'g' },
      { label: 'Salt', grams: 20, unit: 'g' },
    ]);
    expect(working.rest).toEqual({ netWeightG: 500, shelfLifeDays: 3 });
    expect(working).toMatchObject({ netWeight: null, shelfLife: null });
  });

  it('⚠️ net weight and shelf life only when the read has them — 0 days would print today as a use-by', () => {
    expect(workingFromDraft({ name: 'A', ingredients: [{ label: 'x', grams: 1 }] }).rest).toEqual({});
    expect(workingFromDraft({ name: 'A', ingredients: [], netWeightG: 0 }).rest).toEqual({});
    expect(workingFromDraft({ name: 'A', ingredients: [], netWeightG: 'heavy', shelfLifeDays: -2 }).rest).toEqual({});
    expect(workingFromDraft({ name: 'A', ingredients: [], shelfLifeDays: 2 }).rest).toEqual({ shelfLifeDays: 2 });
  });

  it('⚠️ carries no oven loss, whatever the read held, and nothing else it was not meant to', () => {
    const working = workingFromDraft({ ...draft, lossPct: 12, steps: [{ text: 'Mix' }], id: 'x', userId: 'u' });
    expect(working.rest).toEqual({ netWeightG: 500, shelfLifeDays: 3 });
    expect(cleanWorking(working)).not.toHaveProperty('lossPct');
    expect(cleanWorking(working)).not.toHaveProperty('id');
  });

  it('a draft with no rows, or nothing at all, still has one empty row to type into', () => {
    for (const odd of [{ name: 'A' }, { name: 'A', ingredients: [] }, { name: 'A', ingredients: 'x' }, null, undefined, 'text', 5, []]) {
      const working = workingFromDraft(odd);
      expect(working.rows).toHaveLength(1);
      expect(working.rows[0]?.row).toEqual({ label: '', grams: '', unit: 'g' });
    }
    expect(workingFromDraft({ name: 5 }).name).toBe('');
  });

  it('a row that is not an object is an empty row, and every row gets its own key', () => {
    const working = workingFromDraft({ name: 'A', ingredients: [null, 'x', { label: 'Flour', grams: 5 }] });
    expect(working.rows).toHaveLength(3);
    expect(new Set(working.rows.map(item => item.key)).size).toBe(3);
    expect(working.rows[2]?.row).toMatchObject({ label: 'Flour' });
  });

  it('saves like a recipe typed by hand: names trimmed, the rows with no name dropped', () => {
    const clean = cleanWorking(workingFromDraft({ name: ' Pane ', ingredients: [{ label: ' Flour ', grams: 100 }, { label: '', grams: 5 }], netWeightG: 250 }));
    expect(clean.name).toBe('Pane');
    expect(clean.ingredients.map(row => row.label)).toEqual(['Flour']);
    expect(clean).toMatchObject({ netWeightG: 250 });
  });
});

describe('a working copy that travelled in the navigation state (step 3d-9)', () => {
  const typed = workingFrom(null);

  it('comes back whole, with FRESH keys (a reload restarts the counter)', () => {
    const copy = { ...typed, name: 'Pane', rows: [{ key: 1, row: { label: 'Flour', grams: 5, unit: 'g' } }, { key: 1, row: { label: 'Salt', grams: 1, unit: 'g' } }], netWeight: '500', shelfLife: null };
    const back = restoreWorking(JSON.parse(JSON.stringify(copy)));
    expect(back?.name).toBe('Pane');
    expect(back?.rows.map(item => item.row.label)).toEqual(['Flour', 'Salt']);
    expect(new Set(back?.rows.map(item => item.key)).size).toBe(2);
    expect(back).toMatchObject({ netWeight: '500', shelfLife: null });
  });

  it('is nothing at all when it is not a working copy', () => {
    for (const junk of [null, undefined, 5, 'x', [], {}, { name: 5, rows: [] }, { name: 'A', rows: 'x' }, { name: 'A', rows: [null] }, { name: 'A', rows: [{ row: 5 }] }]) {
      expect(restoreWorking(junk), JSON.stringify(junk)).toBeNull();
    }
  });

  it('keeps a row to type into when the copy had none, and ignores a rest that is not an object', () => {
    const back = restoreWorking({ name: 'A', rows: [], rest: 5 });
    expect(back?.rows).toHaveLength(1);
    expect(back?.rest).toEqual({});
  });
});

describe('a duplicate (the recipe page’s «Duplicate»)', () => {
  const original = () => recipe({
    id: 'orig', bakery: 'bakery', netWeightG: 250, shelfLifeDays: 3, endNote: 'Rest 20 min', rawGrams: 1000, cookedGrams: 880,
    steps: [{ text: 'Mix', rows: ['row-a'], seconds: 60, speed: '1' }],
  });
  const copyOf = (name: string) => `${name} (copy)`;

  it('⚠️ is named «<name> (copy)» and takes the pack weight, the shelf life and the procedure', () => {
    const working = duplicateWorking(original(), copyOf);
    expect(working.name).toBe('Focaccia (copy)');
    expect(working.rest).toEqual({
      netWeightG: 250, shelfLifeDays: 3, endNote: 'Rest 20 min',
      steps: [{ text: 'Mix', rows: ['row-a'], seconds: 60, speed: '1' }],
    });
    expect(working.netWeight).toBeNull();
    expect(working.shelfLife).toBeNull();
  });

  it('⚠️⚠️ NEVER carries the original’s id, its venue or its Food cost weighings — and none of them survives cleanWorking', () => {
    const working = duplicateWorking(original(), copyOf);
    for (const key of ['id', 'bakery', 'lossPct', 'rawGrams', 'cookedGrams']) expect(working.rest, key).not.toHaveProperty(key);
    const saved = cleanWorking(working) as unknown as Record<string, unknown>;
    for (const key of ['id', 'bakery', 'lossPct', 'rawGrams', 'cookedGrams']) expect(saved, key).not.toHaveProperty(key);
    expect(saved.name).toBe('Focaccia (copy)');
  });

  it('⚠️ keeps every row as it is — its link, its row id, its amount and unit — so the steps still point at their rows', () => {
    const working = duplicateWorking(original(), copyOf);
    expect(working.rows.map(item => item.row)).toEqual([
      { label: 'Flour', grams: 1000, unit: 'g', kind: 'ingredient', refId: 'ing-1', rid: 'row-a' },
      { label: 'Salt', grams: 0, unit: 'to taste' },
    ]);
    const keys = working.rows.map(item => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is a COPY: changing the duplicate never reaches the original recipe’s procedure', () => {
    const source = original();
    const working = duplicateWorking(source, copyOf);
    ((working.rest.steps as { text: string }[])[0]!).text = 'changed';
    expect((source.steps as { text: string }[])[0]!.text).toBe('Mix');
  });

  it('takes nothing a recipe without them does not have (a recipe with no shelf life stays without one)', () => {
    const bare = duplicateWorking(recipe({ lossPct: undefined, steps: undefined }), copyOf);
    expect(bare.rest).toEqual({});
  });

  it('⚠️ fits the name box: when the whole is too long the ORIGINAL’s end is cut, never the «(copy)»', () => {
    const long = recipe({ name: 'A'.repeat(NAME_MAX_LENGTH) });
    const working = duplicateWorking(long, copyOf);
    expect(working.name).toHaveLength(NAME_MAX_LENGTH);
    expect(working.name.endsWith(' (copy)')).toBe(true);
    expect(duplicateWorking(recipe({ name: 'A'.repeat(NAME_MAX_LENGTH - 7) }), copyOf).name).toHaveLength(NAME_MAX_LENGTH);
  });
});

describe('the category choice (slice «recipe categories + archive»)', () => {
  const LIST = ['Christmas', 'Easter'];
  // The store keeps `category` and `archived` beside the shared normaliser's shape; the editor receives them on the recipe.
  const filed = (fields: Record<string, unknown>): CatalogueRecipe => ({ ...recipe(), ...fields } as CatalogueRecipe);
  const sent = (working: ReturnType<typeof workingFrom>) => cleanWorking(working) as unknown as Record<string, unknown>;

  it('starts from the word as the list spells it, and keeps the stored word and the archive flag out of `rest`', () => {
    const working = workingFrom(filed({ category: ' easter ', archived: true }), LIST);
    expect(working.category).toBe('Easter');
    expect(working.categoryStart).toBe('Easter');
    expect(working.rest).not.toHaveProperty('category');
    expect(working.rest).not.toHaveProperty('archived');
  });

  it('starts from «no category» for a recipe with none, for a word that has left the list, and for a new recipe', () => {
    expect(workingFrom(filed({}), LIST).category).toBe('');
    expect(workingFrom(filed({ category: 'Gone' }), LIST).category).toBe('');
    expect(workingFrom(null, LIST).category).toBe('');
  });

  it('⚠️ hands the category over only when the choice moved', () => {
    const untouched = workingFrom(filed({ category: 'Gone' }), LIST);
    expect(sent(untouched)).not.toHaveProperty('category');
    expect(sent(setCategory(untouched, 'Easter')).category).toBe('Easter');
    const filedUnder = workingFrom(filed({ category: 'Easter' }), LIST);
    expect(sent(setCategory(filedUnder, '')).category).toBe('');
    // Back to where it started: nothing to send.
    expect(sent(setCategory(setCategory(filedUnder, 'Christmas'), 'Easter'))).not.toHaveProperty('category');
  });

  it('hands a new recipe’s category over when one was chosen, and nothing otherwise', () => {
    expect(sent(workingFrom(null, LIST))).not.toHaveProperty('category');
    expect(sent(setCategory(workingFrom(null, LIST), 'Christmas')).category).toBe('Christmas');
  });

  it('⚠️ a duplicate copies the category as a chosen one — and never the archive', () => {
    const copy = duplicateWorking(filed({ category: 'easter', archived: true }), name => `${name} (copy)`, LIST);
    expect(copy.category).toBe('Easter');
    expect(copy.categoryStart).toBe('');
    expect(sent(copy).category).toBe('Easter');
    expect(sent(copy)).not.toHaveProperty('archived');
    expect(duplicateWorking(filed({ category: 'Gone' }), name => name, LIST).category).toBe('');
  });

  it('a photo-read draft starts with no category', () => {
    const working = workingFromDraft({ name: 'A', ingredients: [{ label: 'x', grams: 1 }], category: 'Easter' });
    expect(working.category).toBe('');
    expect(sent(working)).not.toHaveProperty('category');
  });

  it('a copy that travelled in the navigation state keeps both the choice and where it started', () => {
    const working = setCategory(workingFrom(filed({ category: 'Easter' }), LIST), 'Christmas');
    const back = restoreWorking(JSON.parse(JSON.stringify(working)));
    expect(back?.category).toBe('Christmas');
    expect(back?.categoryStart).toBe('Easter');
  });
});
