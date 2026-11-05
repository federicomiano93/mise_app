// label-corpus.ts — the fixture corpus of the whole label chain (parity doc item 110a, 110b).
//
// Recipes, with the ingredient and sub-recipe tables they are read against, chosen so that every branch of
// the chain that decides what is PRINTED or SENT is walked at least once:
//
//   recipeAllergens → canLabel → rowState → flattenIngredients → nutritionPer100g → buildLabel →
//   ingredientLine / containsLine / mayContainLine → declarationText
//
// It is used three ways, all through `runLabelChain` below:
//   * label-corpus.spec.ts runs it through the js/ originals AND the TypeScript ports and demands strict equality;
//   * make-label-golden.mjs (next to this file) runs it ONCE through the js/ originals and writes
//     label-golden.json, which label-corpus.spec.ts then compares the PORTS with — so the ports stay pinned
//     after js/ is deleted at the switch;
//   * later steps (the label template, the ZPL, the print queue) add a field to `runLabelChain`'s output and a
//     function to `LabelChainApi`, regenerate the golden file, and are done: the corpus itself does not change.
//
// ⚠️ ERASABLE TYPESCRIPT ONLY, AND NO IMPORTS. make-label-golden.mjs loads this file with plain `node` (type
// stripping), so no enum, no parameter property, no import of another module. Everything it needs from the
// chain it is handed as `LabelChainApi`.

// ── The corpus ───────────────────────────────────────────────────────────────

export interface CorpusEntry {
  // The key in the golden file.
  readonly id: string;
  // What this recipe is here to exercise, in a sentence a person can check against the label text.
  readonly note: string;
  // Scenario tags: label-corpus.spec.ts fails if one of REQUIRED_TAGS is covered by no entry.
  readonly covers: readonly string[];
  readonly recipe: unknown;
  readonly tables: { readonly ingredients: unknown; readonly recipes: unknown };
}

// Every scenario the parity doc (item 110a) asks the corpus to hold.
export const REQUIRED_TAGS: readonly string[] = [
  'flat', 'sub-recipe', 'same-ingredient-twice', 'pinch-allergen-row', 'findings-c', 'to-taste', 'unknown-ingredient', 'cycle',
  'depth-5', 'loss-pct', 'net-weight-and-shelf-life', 'may-contain', 'may-contain-already-contained', 'full-nutrition',
  'missing-nutrition', 'zero-nutrition', 'unlinked-row', 'deleted-link', 'empty-recipe', 'long-list',
];

const STAMP = '2026-08-11T09:00:00.000Z';

const nutrition = (over: Record<string, number | null> = {}): Record<string, number | null> =>
  ({ kj: 1000, kcal: 240, fat: 2, saturates: 1, carbs: 50, sugars: 3, protein: 8, salt: 0.5, ...over });
const ZERO_NUTRITION = { kj: 0, kcal: 0, fat: 0, saturates: 0, carbs: 0, sugars: 0, protein: 0, salt: 0 };

// Ingredients as `ingredients/{id}` holds them.
const INGREDIENTS: Readonly<Record<string, unknown>> = {
  FLOUR: { name: 'Wheat flour', allergens: ['gluten-wheat'], allergensCheckedAt: STAMP, nutrition: nutrition({ kj: 1420, kcal: 340, fat: 1.2, saturates: 0.2, carbs: 70, sugars: 1.5, protein: 11, salt: 0.01 }) },
  BUTTER: { name: 'Butter', allergens: ['milk'], allergensCheckedAt: STAMP, nutrition: nutrition({ kj: 3000, kcal: 740, fat: 82, saturates: 51, carbs: 0.6, sugars: 0.6, protein: 0.6, salt: 0.02 }) },
  WATER: { name: 'Water', allergens: [], allergensCheckedAt: STAMP, nutrition: ZERO_NUTRITION },
  SALT: { name: 'Salt', allergens: [], allergensCheckedAt: STAMP, nutrition: { ...ZERO_NUTRITION, salt: 100 } },
  SUGAR: { name: 'Sugar', allergens: [], mayContain: ['nuts-hazelnut', 'milk'], allergensCheckedAt: STAMP, nutrition: nutrition({ kj: 1700, kcal: 400, fat: 0, saturates: 0, carbs: 100, sugars: 100, protein: 0, salt: 0 }) },
  EGG: { name: 'Egg', allergens: ['eggs'], allergensCheckedAt: STAMP, nutrition: nutrition({ kj: 600, kcal: 143, fat: 9.5, saturates: 3.1, carbs: 0.7, sugars: 0.4, protein: 12.6, salt: 0.36 }) },
  MUSTARD: { name: 'Mustard', allergens: ['mustard'], allergensCheckedAt: STAMP, nutrition: nutrition() },
  SESAME: { name: 'Sesame seeds', allergens: ['sesame'], allergensCheckedAt: STAMP, nutrition: nutrition({ kj: 2400, kcal: 580, fat: 50, saturates: 7, carbs: 23, sugars: 0.3, protein: 18, salt: 0.04 }) },
  YEAST: { name: 'Yeast', allergens: [], allergensCheckedAt: STAMP, nutrition: nutrition({ kj: 350, kcal: 84, fat: 1.5, saturates: 0.2, carbs: 8, sugars: 0, protein: 40, salt: 0.1 }) },
  OIL: { name: 'Olive oil', allergens: [], allergensCheckedAt: STAMP, nutrition: nutrition({ kj: 3700, kcal: 900, fat: 100, saturates: 14, carbs: 0, sugars: 0, protein: 0, salt: 0 }) },
  ALMOND_MIX: { name: 'Almond mix', allergens: ['nuts-almond', 'gluten-wheat', 'milk', 'eggs'], mayContain: ['sesame', 'nuts-hazelnut', 'milk'], allergensCheckedAt: STAMP, nutrition: nutrition() },
  MULTIGRAIN: { name: 'Multigrain mix', allergens: ['gluten-rye', 'gluten-barley', 'gluten-oats'], allergensCheckedAt: STAMP, nutrition: nutrition({ kcal: 350 }) },
  // Declared, with no nutrition table at all; and one whose table has a hole (salt not filled in).
  NOSPEC: { name: 'No spec', allergens: [], allergensCheckedAt: STAMP },
  HALFSPEC: { name: 'Half spec', allergens: ['eggs'], allergensCheckedAt: STAMP, nutrition: nutrition({ salt: null }) },
  // Never checked: "unknown" must never read as "contains none".
  MYSTERY: { name: 'Mystery mix' },
  // An empty list with no stamp: the same unknown, in the shape that looks innocent.
  EMPTYLIST: { name: 'Unchecked, empty list', allergens: [] },
  // Declared, but nobody typed a name; and one with a short name (every screen shows it, a label does not).
  NONAME: { allergens: [], allergensCheckedAt: STAMP, nutrition: nutrition() },
  SHORT: { name: 'Fresh yeast 500 g block', shortName: 'Yeast', allergens: [], allergensCheckedAt: STAMP, nutrition: nutrition() },
  // An Italian venue's own words: the names are typed, never translated.
  IT_FLOUR: { name: 'Farina di grano tenero tipo 00', allergens: ['gluten-wheat'], allergensCheckedAt: STAMP, nutrition: nutrition({ kj: 1450, kcal: 342, fat: 1, saturates: 0.2, carbs: 72, sugars: 1.5, protein: 10, salt: 0.01 }) },
  IT_OIL: { name: 'Olio extravergine di oliva', allergens: [], allergensCheckedAt: STAMP, nutrition: nutrition({ kj: 3700, kcal: 900, fat: 100, saturates: 14, carbs: 0, sugars: 0, protein: 0, salt: 0 }) },
  IT_MILK: { name: 'Latte intero', allergens: ['milk'], allergensCheckedAt: STAMP, nutrition: nutrition({ kj: 270, kcal: 64, fat: 3.6, saturates: 2.3, carbs: 4.9, sugars: 4.9, protein: 3.3, salt: 0.1 }) },
};

const ingredientsOf = (...ids: string[]): Record<string, unknown> => Object.fromEntries(ids.map(id => [id, INGREDIENTS[id]]));
const row = (label: string, refId: string, grams: number, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ label, grams, unit: 'g', kind: 'ingredient', refId, ...extra });
const subRow = (label: string, refId: string, grams: number): Record<string, unknown> => row(label, refId, grams, { kind: 'recipe' });
const recipe = (id: string, name: string, rows: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ id, name, lossPct: 0, ingredients: rows, ...extra });

const asMaps = (tables: { ingredients: Record<string, unknown>; recipes: Record<string, unknown> }) => ({
  ingredients: new Map(Object.entries(tables.ingredients)), recipes: new Map(Object.entries(tables.recipes)),
});

// Reusable sub-recipes.
const FILLING = recipe('FILLING', 'Filling', [row('Butter', 'BUTTER', 800), row('Salt', 'SALT', 200)]);
const BUTTER_FILLING = recipe('BUTTER_FILLING', 'Butter filling', [row('Butter', 'BUTTER', 1000)]);
const MYSTERY_SUB = recipe('MYSTERY_SUB', 'Mystery sub', [row('Butter', 'BUTTER', 800), row('Mystery', 'MYSTERY', 10)]);
const PINCH_SUB = recipe('PINCH_SUB', 'Pinch sub', [row('Mustard', 'MUSTARD', 1, { unit: 'pinch' })]);

// A chain of nested sub-recipes, `levels` deep, ending in a recipe of plain ingredients.
function chain(levels: number): { top: Record<string, unknown>; recipes: Record<string, unknown> } {
  const recipes: Record<string, unknown> = {};
  for (let i = 0; i < levels; i += 1) {
    const last = i === levels - 1;
    recipes['N' + i] = recipe('N' + i, 'Level ' + i,
      last ? [row('Flour', 'FLOUR', 400), row('Water', 'WATER', 100)] : [subRow('Next', 'N' + (i + 1), 500), row('Flour', 'FLOUR', 500)]);
  }
  return { top: recipes['N0'] as Record<string, unknown>, recipes };
}
const DEEP_OK = chain(4);
const DEEP_5 = chain(5);

const entry = (id: string, covers: readonly string[], note: string, subject: unknown,
  tables: { ingredients: unknown; recipes?: unknown }): CorpusEntry =>
  ({ id, note, covers, recipe: subject, tables: { ingredients: tables.ingredients, recipes: tables.recipes ?? {} } });

// Forty declared ingredients, heaviest first, for the recipe that is too long for a small label.
const LONG_INGREDIENTS: Record<string, unknown> = Object.fromEntries(Array.from({ length: 40 }, (_, i) => ['LONG' + i, {
  name: 'Ingredient number ' + i + ' with a long descriptive name', allergens: i === 3 ? ['milk'] : i === 17 ? ['sesame'] : [], allergensCheckedAt: STAMP, nutrition: nutrition(),
}]));
const LONG_ROWS: unknown[] = Array.from({ length: 40 }, (_, i) => row('Long ' + i, 'LONG' + i, 400 - i * 5));

const BREAD = recipe('BREAD', 'Test bread', [row('Flour', 'FLOUR', 1000), row('Water', 'WATER', 600), row('Butter', 'BUTTER', 200), row('Salt', 'SALT', 20)]);

function build(): CorpusEntry[] {
  return [
    entry('flat-bread', ['flat', 'full-nutrition', 'zero-nutrition'],
      'Four linked, declared rows: the list in descending weight, wheat and milk in capitals, the whole nutrition table; water is real zeros and does not block',
      BREAD, { ingredients: ingredientsOf('FLOUR', 'WATER', 'BUTTER', 'SALT') }),
    entry('sub-recipe-cake', ['sub-recipe'],
      'A sub-recipe is flattened and scaled by how much of it goes in (500 g of a 1000 g filling is half of each of its rows)',
      recipe('CAKE', 'Cake', [row('Flour', 'FLOUR', 500), subRow('Filling', 'FILLING', 500)]),
      { ingredients: ingredientsOf('FLOUR', 'BUTTER', 'SALT'), recipes: { FILLING } }),
    entry('same-ingredient-twice', ['same-ingredient-twice', 'sub-recipe'],
      'Butter in the dough and butter in the filling is ONE line, summed (300 + 500 = 800), and being 800 it outranks 700 g of flour',
      recipe('DOUBLE', 'Double butter', [row('Butter', 'BUTTER', 300), subRow('Filling', 'BUTTER_FILLING', 500), row('Flour', 'FLOUR', 700)]),
      { ingredients: ingredientsOf('FLOUR', 'BUTTER'), recipes: { BUTTER_FILLING } }),
    entry('same-ingredient-two-rows', ['same-ingredient-twice'],
      'The same ingredient in two rows of ONE recipe is one summed line',
      recipe('TWOROWS', 'Two butter rows', [row('Butter', 'BUTTER', 100), row('More butter', 'BUTTER', 150), row('Flour', 'FLOUR', 200)]),
      { ingredients: ingredientsOf('FLOUR', 'BUTTER') }),
    entry('pinch-of-mustard', ['pinch-allergen-row', 'findings-c'],
      'A pinch of mustard is IN the ingredient list, at 0 g after the weighed ones, and in «Contains» (Findings C, fixed by PR #354)',
      recipe('PINCH', 'Mustard loaf', [row('Flour', 'FLOUR', 1000), row('Mustard', 'MUSTARD', 1, { unit: 'pinch' })]),
      { ingredients: ingredientsOf('FLOUR', 'MUSTARD') }),
    entry('to-taste-sesame', ['to-taste', 'pinch-allergen-row', 'findings-c'],
      'A «to taste» row of salt and one of sesame: both are listed after the flour, by name; the sesame is in «Contains»',
      recipe('TASTE', 'Seeded loaf', [row('Flour', 'FLOUR', 1000), row('Salt', 'SALT', 0, { unit: 'to taste' }), row('Sesame', 'SESAME', 0, { unit: 'to taste' })]),
      { ingredients: ingredientsOf('FLOUR', 'SALT', 'SESAME') }),
    entry('unknown-ingredient', ['unknown-ingredient'],
      'An ingredient nobody has checked: the whole recipe is refused, with the gap named',
      recipe('UNKNOWN', 'Unknown', [row('Flour', 'FLOUR', 1000), row('Mystery', 'MYSTERY', 10)]),
      { ingredients: ingredientsOf('FLOUR', 'MYSTERY') }),
    entry('unknown-empty-list', ['unknown-ingredient'],
      'An empty allergen list with NO stamp is unknown, never «contains none»',
      recipe('UNCHECKED', 'Unchecked', [row('Flour', 'FLOUR', 1000), row('Unchecked', 'EMPTYLIST', 50)]),
      { ingredients: ingredientsOf('FLOUR', 'EMPTYLIST') }),
    entry('cycle-self', ['cycle'],
      'A recipe that contains itself ends in a «cycle» gap, not a hung screen',
      recipe('LOOP', 'Loop', [row('Flour', 'FLOUR', 500), subRow('Itself', 'LOOP', 100)]),
      { ingredients: ingredientsOf('FLOUR'), recipes: { LOOP: recipe('LOOP', 'Loop', [row('Flour', 'FLOUR', 500), subRow('Itself', 'LOOP', 100)]) } }),
    entry('cycle-pair', ['cycle'],
      'Two recipes containing each other',
      recipe('PING', 'Ping', [row('Flour', 'FLOUR', 500), subRow('Pong', 'PONG', 100)]),
      { ingredients: ingredientsOf('FLOUR'), recipes: {
        PING: recipe('PING', 'Ping', [row('Flour', 'FLOUR', 500), subRow('Pong', 'PONG', 100)]),
        PONG: recipe('PONG', 'Pong', [row('Water', 'WATER', 500), subRow('Ping', 'PING', 100)]),
      } }),
    entry('depth-4-ok', ['sub-recipe'],
      'Four levels of nesting are the deepest that is read: this one labels',
      DEEP_OK.top, { ingredients: ingredientsOf('FLOUR', 'WATER'), recipes: DEEP_OK.recipes }),
    entry('depth-5', ['depth-5'],
      'Five levels of nesting is past the limit: the deepest gap is «too-deep», the top of the recipe sees «sub-incomplete», no label; the flattened list stops at the same depth',
      DEEP_5.top, { ingredients: ingredientsOf('FLOUR', 'WATER'), recipes: DEEP_5.recipes }),
    entry('loss-20', ['loss-pct', 'full-nutrition'],
      'lossPct 20: every nutrition value is per 100 g of the FINISHED food, a quarter higher than per 100 g of dough',
      recipe('BAKED', 'Baked bread', [row('Flour', 'FLOUR', 1000), row('Water', 'WATER', 600), row('Salt', 'SALT', 20)], { lossPct: 20 }),
      { ingredients: ingredientsOf('FLOUR', 'WATER', 'SALT') }),
    entry('loss-99', ['loss-pct'],
      'The most loss a recipe may state (99 %): the yield is a hundredth of what went in',
      recipe('DRIED', 'Dried', [row('Flour', 'FLOUR', 1000), row('Water', 'WATER', 1000)], { lossPct: 99 }),
      { ingredients: ingredientsOf('FLOUR', 'WATER') }),
    entry('net-weight-and-shelf-life', ['net-weight-and-shelf-life', 'full-nutrition'],
      'netWeightG and shelfLifeDays ride on the recipe for the later label steps and must change nothing in the text',
      recipe('PACKED', 'Packed brioche', [row('Flour', 'FLOUR', 600), row('Egg', 'EGG', 120), row('Butter', 'BUTTER', 200), row('Sugar', 'SUGAR', 80)], { lossPct: 12, netWeightG: 250, shelfLifeDays: 3 }),
      { ingredients: ingredientsOf('FLOUR', 'EGG', 'BUTTER', 'SUGAR') }),
    entry('may-contain', ['may-contain', 'may-contain-already-contained'],
      'Sugar «may contain» hazelnut and milk; butter contains milk: milk stays in «Contains» and is dropped from the traces, hazelnut stays a trace',
      recipe('TRACES', 'Traces', [row('Sugar', 'SUGAR', 300), row('Butter', 'BUTTER', 300)]),
      { ingredients: ingredientsOf('SUGAR', 'BUTTER') }),
    entry('many-allergens', ['may-contain'],
      'Many allergens at once: the order is the order of the codes, the specific cereals and nut are named',
      recipe('MIXED', 'Mixed', [row('Almond mix', 'ALMOND_MIX', 400), row('Multigrain', 'MULTIGRAIN', 300), row('Sesame', 'SESAME', 100)]),
      { ingredients: ingredientsOf('ALMOND_MIX', 'MULTIGRAIN', 'SESAME') }),
    entry('missing-nutrition', ['missing-nutrition'],
      'One declared ingredient has no nutrition table: the allergens are known, the nutrition is null and the label says it is missing',
      recipe('NOSPEC', 'No spec', [row('Flour', 'FLOUR', 1000), row('No spec', 'NOSPEC', 100)]),
      { ingredients: ingredientsOf('FLOUR', 'NOSPEC') }),
    entry('half-nutrition', ['missing-nutrition'],
      'One ingredient whose table has a hole (salt not filled in): no table at all, never a partial sum',
      recipe('HALF', 'Half spec', [row('Flour', 'FLOUR', 1000), row('Half spec', 'HALFSPEC', 100)]),
      { ingredients: ingredientsOf('FLOUR', 'HALFSPEC') }),
    entry('zero-nutrition-only', ['zero-nutrition'],
      'Only water: every value is a real zero, not a missing one',
      recipe('H2O', 'Water', [row('Water', 'WATER', 500)]),
      { ingredients: ingredientsOf('WATER') }),
    entry('unlinked-row', ['unlinked-row'],
      'A row linked to nothing makes the recipe unlabelable',
      recipe('LOOSE', 'Loose', [row('Flour', 'FLOUR', 1000), { label: 'Something', grams: 50, unit: 'g' }]),
      { ingredients: ingredientsOf('FLOUR') }),
    entry('deleted-link', ['deleted-link'],
      'A row linked to an ingredient that has been deleted',
      recipe('GONE', 'Gone', [row('Flour', 'FLOUR', 1000), row('Gone', 'DELETED', 100)]),
      { ingredients: ingredientsOf('FLOUR') }),
    entry('empty-recipe', ['empty-recipe'],
      'A recipe with no rows is not «contains none»',
      recipe('EMPTY', 'Empty', []), { ingredients: ingredientsOf('FLOUR') }),
    entry('only-unweighable', ['to-taste'],
      'Every row declared, none weighable: the recipe is complete and there is nothing to list («no-ingredients»)',
      recipe('PIECES', 'Pieces', [row('Eggs', 'EGG', 3, { unit: 'pcs' }), row('Salt', 'SALT', 0, { unit: 'to taste' })]),
      { ingredients: ingredientsOf('EGG', 'SALT') }),
    entry('unnamed-ingredient', ['flat'],
      'A declared ingredient nobody named prints as the English «Unnamed ingredient» (kept for parity)',
      recipe('NONAME', 'Unnamed', [row('Flour', 'FLOUR', 500), row('No name', 'NONAME', 100)]),
      { ingredients: ingredientsOf('FLOUR', 'NONAME') }),
    entry('short-name', ['flat'],
      'A label prints an ingredient’s name, never its short name',
      recipe('SHORT', 'Short', [row('Yeast', 'SHORT', 20), row('Flour', 'FLOUR', 500)]),
      { ingredients: ingredientsOf('FLOUR', 'SHORT') }),
    entry('blank-row', ['flat'],
      'A blank half-typed line is not a gap',
      recipe('BLANK', 'Blank row', [row('Flour', 'FLOUR', 500), { label: '   ', grams: 0 }]),
      { ingredients: ingredientsOf('FLOUR') }),
    entry('no-label-row', ['flat'],
      'A linked, declared row with no label is not a gap and is printed',
      recipe('NOLABEL', 'No label', [row('', 'FLOUR', 500), row('Water', 'WATER', 300)]),
      { ingredients: ingredientsOf('FLOUR', 'WATER') }),
    entry('poisoned-by-sub', ['unknown-ingredient', 'sub-recipe'],
      'An incomplete sub-recipe poisons the whole thing and contributes NOTHING (its milk must not leak up)',
      recipe('POISONED', 'Poisoned', [row('Flour', 'FLOUR', 500), subRow('Sub', 'MYSTERY_SUB', 100)]),
      { ingredients: ingredientsOf('FLOUR', 'BUTTER', 'MYSTERY'), recipes: { MYSTERY_SUB } }),
    entry('sub-with-no-weight', ['sub-recipe', 'pinch-allergen-row', 'findings-c'],
      'A sub-recipe whose only row is a pinch of mustard: the mustard is listed (0 g) and reaches «Contains»; the sub-recipe itself is never named',
      recipe('PINCHED', 'Pinched', [row('Flour', 'FLOUR', 500), subRow('Spice', 'PINCH_SUB', 100)]),
      { ingredients: ingredientsOf('FLOUR', 'MUSTARD'), recipes: { PINCH_SUB } }),
    entry('equal-weights', ['flat'],
      'Equal weights break by name, so two runs print the same label',
      recipe('TIE', 'Tie', [row('Sugar', 'SUGAR', 100), row('Flour', 'FLOUR', 100), row('Butter', 'BUTTER', 100)]),
      { ingredients: ingredientsOf('SUGAR', 'FLOUR', 'BUTTER') }),
    entry('italian-venue', ['flat', 'full-nutrition'],
      'An Italian bakery’s own ingredient names: they print verbatim whatever the label’s language',
      recipe('PIZZA', 'Pizza bianca', [row('Farina', 'IT_FLOUR', 1000), row('Acqua', 'WATER', 700), row('Olio', 'IT_OIL', 50), row('Latte', 'IT_MILK', 100), row('Sale', 'SALT', 20)], { lossPct: 15 }),
      { ingredients: ingredientsOf('IT_FLOUR', 'WATER', 'IT_OIL', 'IT_MILK', 'SALT') }),
    entry('long-ingredient-list', ['flat', 'long-list'],
      'Forty declared ingredients with long names (two carry allergens): too much for the small ZPL paper whatever the size of the text, so the template reports «does not fit» there and keeps every word',
      recipe('LONG', 'Long list', LONG_ROWS), { ingredients: LONG_INGREDIENTS }),
    entry('map-tables', ['flat', 'sub-recipe'],
      'The tables handed over as Maps instead of plain objects',
      recipe('CAKE', 'Cake from maps', [row('Flour', 'FLOUR', 500), subRow('Filling', 'FILLING', 500)]),
      asMaps({ ingredients: ingredientsOf('FLOUR', 'BUTTER', 'SALT'), recipes: { FILLING } })),
  ];
}

// Deep freeze: a function that edits what it is handed would otherwise change the next combination's input
// in silence. (A Map is frozen as an object, which does not stop set() — the chain does not call it.)
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
    if ((value as unknown) instanceof Map) for (const inner of (value as unknown as Map<unknown, unknown>).values()) deepFreeze(inner);
  }
  return value;
}

export const LABEL_CORPUS: readonly CorpusEntry[] = deepFreeze(build());

// ── The combinations ─────────────────────────────────────────────────────────

// The venues a label is built for. `FR` is a country the app does not support (its output language is null,
// the label screen refuses to draw, and the text builders — handed null — answer in English); `none` is no
// country at all. The text is computed for all four, so the golden file pins what each would print.
export const LOCATIONS: Readonly<Record<string, unknown>> = Object.freeze({
  GB: Object.freeze({ country: 'GB' }),
  IT: Object.freeze({ country: 'IT' }),
  FR: Object.freeze({ country: 'FR' }),
  none: null,
});

// What the label's switch may hold, and a junk value (anything else falls back to «both»).
export const SHOWS_UNDER_TEST: readonly string[] = Object.freeze(['allergens', 'nutrition', 'both', 'nonsense']);

// The word for an ingredient that no longer exists, as the original reads it (`cat.unknownIngredient`).
export const UNKNOWN_INGREDIENT = 'Unknown ingredient';

// ── The label template (step 3d-3) ───────────────────────────────────────────

// The day every batch in the corpus is «made», in LOCAL time (the template adds days and formats in local
// time), so the date a label prints never depends on when the suite runs.
export const MADE_ON_PARTS: readonly [number, number, number, number] = Object.freeze([2026, 8, 3, 12] as const);   // 3 Sep 2026, noon

// Three venues' label settings: the stock the app ships with; a small ZPL label at 300 dpi (capitals for the
// allergens, a tight page); and a big label with every optional block switched on and written (best before).
export const TEMPLATE_PROFILES: Readonly<Record<string, unknown>> = Object.freeze({
  default: Object.freeze({}),
  'zpl-57x32': Object.freeze({ widthMm: 57, heightMm: 32, printerLanguage: 'zpl', dpi: 300 }),
  'full-102x76': Object.freeze({
    widthMm: 102, heightMm: 76, showDate: true, showWeight: true, showStorage: true, showBusiness: true, dateKind: 'bestBefore',
    storageText: 'Keep refrigerated', businessName: 'A Bakery', businessAddress: '1 High Street',
  }),
});

// Recipes that carry no weight and no shelf life of their own are given 1200 g and 3 days, so the net-weight
// and date blocks are exercised on almost every recipe; these two are left bare, to pin «nothing to say».
const BARE_BATCHES: readonly string[] = Object.freeze(['map-tables', 'unnamed-ingredient']);

// ── The chain ────────────────────────────────────────────────────────────────

type Fn = (...args: any[]) => unknown;

// Everything the chain calls. The js/ originals and the TypeScript ports are both adapted to this shape.
export interface LabelChainApi {
  readonly outputLanguage: Fn;
  readonly canPrintLabel: Fn;
  readonly recipeAllergens: Fn;
  readonly canLabel: Fn;
  readonly rowState: Fn;
  readonly rowIsBlocked: Fn;
  readonly flattenIngredients: Fn;
  readonly nutritionPer100g: Fn;
  readonly buildLabel: Fn;
  readonly ingredientLine: Fn;
  readonly containsLine: Fn;
  readonly mayContainLine: Fn;
  readonly declarationText: Fn;
  // (recipes, tables) → the work list; the port's third argument is bound by the adapter.
  readonly blockingIngredients: Fn;
  readonly unlinkedRowNames: Fn;
  // The label template (step 3d-3): the layout, the text of each block, and the date a batch is given.
  readonly resolveLabel: Fn;
  readonly blockText: Fn;
  readonly useByDate: Fn;
  readonly dateText: Fn;
}

// What the chain produces for one recipe. ⚠️ ADDING A STEP IS ADDING A FIELD HERE (and the function it calls to
// LabelChainApi): then regenerate label-golden.json with make-label-golden.mjs.
export interface ChainOutput {
  // The allergen gate: what the recipe contains and whether every row is accounted for.
  readonly gate: unknown;
  readonly canLabel: unknown;
  readonly rowState: unknown;
  readonly rowIsBlocked: unknown;
  // What the work lists would say about this recipe alone.
  readonly blocking: unknown;
  readonly unlinked: unknown;
  // The ingredient list and the nutrition per 100 g, whether or not the gate lets a label through.
  readonly flat: unknown;
  readonly nutrition: unknown;
  // The label laid out on paper: per label profile and per venue. See runTemplates.
  readonly template: Readonly<Record<string, Readonly<Record<string, TemplateOutput>>>>;
  // Per switch value: the label, and per venue the text it would print.
  readonly shows: Readonly<Record<string, {
    readonly label: unknown;
    // The capitals line does not depend on the language.
    readonly ingredientLine: unknown;
    readonly venues: Readonly<Record<string, {
      readonly lang: unknown;
      readonly canPrint: unknown;
      readonly containsLine: unknown;
      readonly mayContainLine: unknown;
      readonly declaration: unknown;
      readonly declarationWithoutNutrition: unknown;
    }>>;
  }>>;
}

// One venue's label laid out under one profile. `resolved` is resolveLabel's whole answer (a refusal is a
// refusal); `blockTexts` is what each block measures as, in the emphasis the printer uses.
export interface TemplateOutput {
  readonly extras: unknown;
  readonly resolved: unknown;
  readonly blockTexts: readonly string[];
}

// The label template for one recipe: every profile × every venue, for the label built with the switch at
// `wants` (the layout reads the name, the ingredients and the two allergen lines, never the nutrition, so the
// golden file holds it for 'both' only and label-corpus.spec.ts proves the other switches lay out identically).
export function runTemplates(api: LabelChainApi, subject: CorpusEntry, wants: string = 'both'): Record<string, Record<string, TemplateOutput>> {
  const { recipe: r, tables, id } = subject;
  const card = r as { netWeightG?: unknown; shelfLifeDays?: unknown };
  const bare = BARE_BATCHES.includes(id);
  const made = new Date(...MADE_ON_PARTS);
  const label = api.buildLabel(r, tables, { shows: wants });
  const out: Record<string, Record<string, TemplateOutput>> = {};
  for (const [profileName, profile] of Object.entries(TEMPLATE_PROFILES)) {
    const venues: Record<string, TemplateOutput> = {};
    for (const [venue, location] of Object.entries(LOCATIONS)) {
      const lang = api.outputLanguage(location);
      const extras = bare ? {} : {
        netWeightG: card.netWeightG ?? 1200,
        dateText: api.dateText(api.useByDate(card.shelfLifeDays ?? 3, made), lang),
      };
      const resolved = api.resolveLabel(label, profile, extras, lang) as { ok?: boolean; blocks?: unknown[]; emphasis?: unknown };
      const blockTexts = resolved.ok ? (resolved.blocks as unknown[]).map(block => api.blockText(block, resolved.emphasis) as string) : [];
      venues[venue] = { extras, resolved, blockTexts };
    }
    out[profileName] = venues;
  }
  return out;
}

export function runLabelChain(api: LabelChainApi, subject: CorpusEntry): ChainOutput {
  const { recipe: r, tables } = subject;
  const gate = api.recipeAllergens(r, tables);
  const shows: Record<string, ChainOutput['shows'][string]> = {};
  for (const wants of SHOWS_UNDER_TEST) {
    const label = api.buildLabel(r, tables, { shows: wants });
    const venues: Record<string, ChainOutput['shows'][string]['venues'][string]> = {};
    for (const [venue, location] of Object.entries(LOCATIONS)) {
      const lang = api.outputLanguage(location);
      venues[venue] = {
        lang,
        canPrint: api.canPrintLabel(location),
        containsLine: api.containsLine(label, lang),
        mayContainLine: api.mayContainLine(label, lang),
        declaration: api.declarationText(label, lang),
        declarationWithoutNutrition: api.declarationText(label, lang, { withNutrition: false }),
      };
    }
    shows[wants] = { label, ingredientLine: api.ingredientLine(label), venues };
  }
  return {
    gate,
    canLabel: api.canLabel(gate),
    rowState: api.rowState(gate),
    rowIsBlocked: api.rowIsBlocked(api.rowState(gate)),
    blocking: api.blockingIngredients([r], tables),
    unlinked: api.unlinkedRowNames([r]),
    flat: api.flattenIngredients(r, tables),
    nutrition: api.nutritionPer100g(r, tables),
    template: runTemplates(api, subject),
    shows,
  };
}

// The whole corpus through one implementation, as the plain JSON the golden file holds.
export function runCorpus(api: LabelChainApi): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const subject of LABEL_CORPUS) out[subject.id] = JSON.parse(stableStringify(runLabelChain(api, subject)));
  return out;
}

// JSON with the keys of every object in sorted order, so the same data is always the same text. A NaN or an
// Infinity would become null in JSON and hide a difference, so they are refused.
export function stableStringify(value: unknown, indent: number = 2): string {
  const walk = (inner: unknown): unknown => {
    if (typeof inner === 'number' && !Number.isFinite(inner)) throw new Error('the corpus produced ' + String(inner));
    if (Array.isArray(inner)) return inner.map(walk);
    if (inner && typeof inner === 'object') {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(inner).sort()) out[key] = walk((inner as Record<string, unknown>)[key]);
      return out;
    }
    return inner;
  };
  return JSON.stringify(walk(value), null, indent);
}
