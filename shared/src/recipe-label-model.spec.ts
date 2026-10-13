// What goes on a label: the ingredient list in the order the law asks for, the allergens emphasised inside
// it, the nutrition per 100 g of the FINISHED food, and the declaration as plain text — run against BOTH
// implementations: the TypeScript port in shared/ and js/catalogue/recipe-label-model.js, which the live app
// uses today. Ported from tests/recipe-label-model.test.mjs (all 21 tests) and from the pure half of
// tests/recipe-declaration.test.mjs (the 8 that build text: 'ordered by weight', 'the allergen-bearing rows
// are marked', '«may contain» is never merged', 'the food words follow the COUNTRY', 'the INGREDIENT NAMES
// are the venue's own words', 'an unknown country… answered in English', 'a message leaves the nutrition
// table out', 'an undeclared recipe produces no text at all'). The two must stay equal until the
// switch to Mise 2; recipe-label-model.ts is a full port, so parity.spec.ts pairs it.
//
// LEFT FOR THE APP SLICE of step 3d-2 (recipe-declaration.test.mjs reads the screen's source text, or the
// interface dictionary): 'a recipe that cannot be labelled offers no way to send one', 'allergens switched
// off means no declaration card at all', 'the declaration is rebuilt with the cost and allergen cards',
// 'the card asks the COUNTRY for its language', 'a message leaves the nutrition table out, at the call site
// too', 'the recipe screen formats no money at all', 'mailto opens the mail app…', 'no navigator.share'.
// The source-text half of 'the INGREDIENT NAMES are the venue's own words' is in label-separation.spec.ts.
//
// ⚠️ Two rules govern every test here. Nothing is produced unless the recipe is
// fully declared; and a declaration is a WHOLE — half a nutrition table is not a
// smaller answer, it is no answer.

import { describe, expect, test } from 'vitest';
import * as ported from './recipe-label-model';
import { outputLanguage } from './market';
import * as legacyJs from '../../js/catalogue/recipe-label-model.js';
import { setLanguage, currentLanguage } from '../../js/i18n.js';

const legacy = legacyJs as unknown as typeof ported;

type Obj = Record<string, any>;

const STAMP = '2026-08-11T09:00:00.000Z';
const full = (over: Obj = {}): Obj => ({ kj: 1000, kcal: 240, fat: 2, saturates: 1, carbs: 50, sugars: 3, protein: 8, salt: 0.5, ...over });

const ingredients = (): Obj => ({
  FLOUR: { id: 'FLOUR', name: 'Flour', allergens: ['gluten-wheat'], allergensCheckedAt: STAMP, nutrition: full({ kcal: 340, carbs: 70 }) },
  BUTTER: { id: 'BUTTER', name: 'Butter', allergens: ['milk'], allergensCheckedAt: STAMP, nutrition: full({ kcal: 740, fat: 82, saturates: 51, carbs: 0 }) },
  WATER: { id: 'WATER', name: 'Water', allergens: [], allergensCheckedAt: STAMP, nutrition: full({ kj: 0, kcal: 0, fat: 0, saturates: 0, carbs: 0, sugars: 0, protein: 0, salt: 0 }) },
  SALT: { id: 'SALT', name: 'Salt', allergens: [], allergensCheckedAt: STAMP, nutrition: full({ kj: 0, kcal: 0, fat: 0, saturates: 0, carbs: 0, sugars: 0, protein: 0, salt: 100 }) },
  NOSPEC: { id: 'NOSPEC', name: 'No spec', allergens: [], allergensCheckedAt: STAMP },  // declared, but no nutrition
});

const row = (label: string, refId: string, grams: number, kind = 'ingredient'): Obj => ({ label, grams, unit: 'g', kind, refId });
const recipe = (id: string, rows: unknown[], extra: Obj = {}): Obj => ({ id, name: id, ingredients: rows, ...extra });

const bread = (): Obj => recipe('BREAD', [
  row('Flour', 'FLOUR', 1000),
  row('Water', 'WATER', 600),
  row('Butter', 'BUTTER', 200),
  row('Salt', 'SALT', 20),
], { name: 'Test bread' });

// The fixture of recipe-declaration.test.mjs: a recipe whose rows are all linked and all declared.
const DECL_TABLES: Obj = {
  ingredients: {
    FLOUR: { name: 'Wheat flour', allergens: ['gluten-wheat'], allergensCheckedAt: 1 },
    WATER: { name: 'Water', allergens: [], allergensCheckedAt: 1 },
    BUTTER: { name: 'Butter', allergens: ['milk'], mayContain: ['nuts-hazelnut'], allergensCheckedAt: 1 },
  },
  recipes: {},
};
const DECL_RECIPE: Obj = {
  id: 'R1', name: 'Focaccia', lossPct: 0,
  ingredients: [
    { label: 'Butter', grams: 200, unit: 'g', kind: 'ingredient', refId: 'BUTTER' },
    { label: 'Wheat flour', grams: 1000, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
    { label: 'Water', grams: 700, unit: 'g', kind: 'ingredient', refId: 'WATER' },
  ],
};

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  // The label as the screens read it: anything may be inside it, so the tests index freely.
  const build = (r: unknown, t: Obj = {}, o?: Obj): Obj => m.buildLabel(r, t, o) as unknown as Obj;
  const flat = (r: unknown, t: Obj = {}) => m.flattenIngredients(r, t);
  const nutri = (r: unknown, t: Obj = {}) => m.nutritionPer100g(r, t) as Obj | null;

  // ── The ingredient list ────────────────────────────────────────────────────

  test('the list is in DESCENDING weight order — the order the law asks for', () => {
    const out = flat(bread(), { ingredients: ingredients() });
    expect(out.map(i => i.name)).toStrictEqual(['Flour', 'Water', 'Butter', 'Salt']);
  });

  test('a sub-recipe is FLATTENED, not named', () => {
    // A label may not say "filling" and stop — the reader needs the actual things.
    const filling = recipe('SUB', [row('Butter', 'BUTTER', 800), row('Salt', 'SALT', 200)]);
    const cake = recipe('R1', [row('Flour', 'FLOUR', 500), row('Filling', 'SUB', 500, 'recipe')]);
    const out = flat(cake, { ingredients: ingredients(), recipes: { SUB: filling } });
    expect(out.map(i => i.name)).toStrictEqual(['Flour', 'Butter', 'Salt']);
    expect(out.find(i => i.name === 'Filling'), 'the sub-recipe must not appear by name').toBeUndefined();
  });

  test('…and is scaled to how much of it goes in', () => {
    // 500 g of a 1000 g filling is HALF of each of its ingredients.
    const filling = recipe('SUB', [row('Butter', 'BUTTER', 800), row('Salt', 'SALT', 200)]);
    const cake = recipe('R1', [row('Filling', 'SUB', 500, 'recipe')]);
    const out = flat(cake, { ingredients: ingredients(), recipes: { SUB: filling } });
    expect(Math.round(out.find(i => i.name === 'Butter')?.grams as number)).toBe(400);
    expect(Math.round(out.find(i => i.name === 'Salt')?.grams as number)).toBe(100);
  });

  test('THE SAME INGREDIENT USED TWICE IS ONE LINE, SUMMED', () => {
    // ⚠️ Butter in the dough and butter in the filling is butter. Two lines would
    // look wrong AND sort wrong: two half-weights sit lower than the one real one.
    const filling = recipe('SUB', [row('Butter', 'BUTTER', 1000)]);
    const cake = recipe('R1', [
      row('Butter', 'BUTTER', 300),
      row('Filling', 'SUB', 500, 'recipe'),
      row('Flour', 'FLOUR', 700),
    ]);
    const out = flat(cake, { ingredients: ingredients(), recipes: { SUB: filling } });
    expect(out.filter(i => i.name === 'Butter').length, 'butter appeared twice').toBe(1);
    expect(Math.round(out.find(i => i.name === 'Butter')?.grams as number), '300 + 500').toBe(800);
    // …and being 800 it now outranks the 700 g of flour.
    expect(out.map(i => i.name)).toStrictEqual(['Butter', 'Flour']);
  });

  test('the order is stable between two runs', () => {
    const r = recipe('R1', [row('a', 'FLOUR', 100), row('b', 'BUTTER', 100)]);
    const one = flat(r, { ingredients: ingredients() }).map(i => i.name);
    const two = flat(r, { ingredients: ingredients() }).map(i => i.name);
    expect(one).toStrictEqual(two);
    expect(one, 'equal weights break by name').toStrictEqual(['Butter', 'Flour']);
  });

  test('a cycle and an over-deep nesting do not hang it', () => {
    const self = recipe('R1', [row('itself', 'R1', 100, 'recipe')]);
    expect(flat(self, { ingredients: ingredients(), recipes: { R1: self } })).toStrictEqual([]);
  });

  // ── Nutrition ──────────────────────────────────────────────────────────────

  test('PER 100 g OF THE FINISHED FOOD, NOT OF THE DOUGH', () => {
    // ⚠️ Water leaves in the oven. 1820 g of dough at 20% loss is 1456 g of bread,
    // so every value per 100 g of bread is HIGHER than per 100 g of dough. Using
    // the mixing weight understates a bread label by about a fifth.
    const dough = nutri(bread(), { ingredients: ingredients() }) as Obj;
    const baked = nutri({ ...bread(), lossPct: 20 }, { ingredients: ingredients() }) as Obj;
    expect(baked['kcal'], `${baked['kcal']} should exceed ${dough['kcal']}`).toBeGreaterThan(dough['kcal']);
    expect(baked['lossPct']).toBe(20);
    expect(dough['lossPct']).toBe(0);
    // …and by the right factor: 1 / 0.8 = 1.25
    expect(Math.abs(baked['kcal'] / dough['kcal'] - 1.25), `${baked['kcal']} / ${dough['kcal']}`).toBeLessThan(0.02);
  });

  test('the arithmetic is right on a simple case', () => {
    // 1000 g of flour at 340 kcal/100 g, no loss → 340 kcal per 100 g.
    const out = nutri(recipe('R1', [row('Flour', 'FLOUR', 1000)]), { ingredients: ingredients() }) as Obj;
    expect(out['kcal']).toBe(340);
    expect(out['carbs']).toBe(70);
  });

  test('ONE INGREDIENT WITHOUT A FULL TABLE MEANS NO TABLE AT ALL', () => {
    // ⚠️ Summing the seven over the ingredients that happen to have them would
    // under-declare every value by however much is missing, and nothing on the
    // label would say so.
    const r = recipe('R1', [row('Flour', 'FLOUR', 1000), row('Mystery', 'NOSPEC', 100)]);
    expect(nutri(r, { ingredients: ingredients() })).toBe(null);
  });

  test('an all-zero ingredient is a real one and does not block', () => {
    // Water: really 0 everything. It must dilute the result, not refuse it.
    const out = nutri(recipe('R1', [row('Flour', 'FLOUR', 500), row('Water', 'WATER', 500)]),
      { ingredients: ingredients() });
    expect(out).not.toBe(null);
    expect(out?.['kcal'], 'half flour, half water').toBe(170);
  });

  test('salt keeps two decimals — 0.1 g would print as 0.0 otherwise', () => {
    const out = nutri(recipe('R1', [row('Flour', 'FLOUR', 1000), row('Salt', 'SALT', 20)]),
      { ingredients: ingredients() }) as Obj;
    expect(out['salt'], 'salt rounded away to zero').toBeGreaterThan(0);
    expect(String(out['salt']).includes('.'), `${out['salt']} lost its decimals`).toBe(true);
  });

  test('an empty recipe has no declaration', () => {
    expect(nutri(recipe('R1', []), { ingredients: ingredients() })).toBe(null);
    expect(nutri(null, {})).toBe(null);
  });

  // ── The whole label ────────────────────────────────────────────────────────

  test('A RECIPE THAT IS NOT FULLY DECLARED PRODUCES NO LABEL', () => {
    // ⚠️ The one gate. Everything else in this file assumes it has been passed.
    const ings = ingredients();
    ings['UNKNOWN'] = { id: 'UNKNOWN', name: 'Unknown' };   // never checked
    const r = recipe('R1', [row('Flour', 'FLOUR', 1000), row('Unknown', 'UNKNOWN', 10)]);
    const label = build(r, { ingredients: ings });
    expect(label['ok']).toBe(false);
    expect(label['reason']).toBe('not-declared');
    expect(label['gaps'].length).toBeGreaterThanOrEqual(1);
    expect(label['ingredients'], 'no list may be handed out at all').toBeUndefined();
  });

  test('a declared recipe produces a list with the allergens marked INSIDE it', () => {
    // The regulation asks for the allergen to be emphasised in the ingredient list,
    // not only summarised underneath.
    const label = build(bread(), { ingredients: ingredients() });
    expect(label['ok']).toBe(true);
    expect(label['ingredients'].map((i: Obj) => i['name'])).toStrictEqual(['Flour', 'Water', 'Butter', 'Salt']);
    expect(label['ingredients'].find((i: Obj) => i['name'] === 'Flour').emphasise).toBe(true);
    expect(label['ingredients'].find((i: Obj) => i['name'] === 'Water').emphasise).toBe(false);
    expect(label['allergens']).toStrictEqual(['gluten-wheat', 'milk']);
  });

  test('the plain-text line puts the allergens in CAPITALS', () => {
    const label = build(bread(), { ingredients: ingredients() });
    expect(m.ingredientLine(label)).toBe('FLOUR, Water, BUTTER, Salt');
    expect(m.containsLine(label)).toBe('Contains: Wheat, Milk');
    expect(m.ingredientLine({ ok: false })).toBe('');
  });

  test('"Contains:" is empty rather than saying "nothing"', () => {
    const label = build(recipe('R1', [row('Water', 'WATER', 100)]), { ingredients: ingredients() });
    expect(label['ok']).toBe(true);
    expect(m.containsLine(label)).toBe('');
  });

  test('the switch decides what is worked out, not just what is shown', () => {
    const tables = { ingredients: ingredients() };
    expect(build(bread(), tables, { shows: 'allergens' })['nutrition']).toBe(null);
    expect(build(bread(), tables, { shows: 'nutrition' })['nutrition']).not.toBe(null);
    expect(build(bread(), tables, { shows: 'both' })['nutrition']).not.toBe(null);
    expect([...m.LABEL_SHOWS]).toStrictEqual(['allergens', 'nutrition', 'both']);
    // An unknown value falls back to showing everything rather than silently less.
    expect(build(bread(), tables, { shows: 'nonsense' })['nutrition']).not.toBe(null);
  });

  test('A LABEL ASKED FOR NUTRITION IT CANNOT WORK OUT SAYS SO', () => {
    // ⚠️ Otherwise it prints the allergen half and looks finished.
    const ings = ingredients();
    const r = recipe('R1', [row('Flour', 'FLOUR', 1000), row('No spec', 'NOSPEC', 100)]);
    const label = build(r, { ingredients: ings }, { shows: 'both' });
    expect(label['ok'], 'the allergens are still known').toBe(true);
    expect(label['nutrition']).toBe(null);
    expect(label['nutritionMissing']).toBe(true);
  });

  test('…and one asked only for allergens does not claim nutrition is missing', () => {
    const r = recipe('R1', [row('Flour', 'FLOUR', 1000), row('No spec', 'NOSPEC', 100)]);
    const label = build(r, { ingredients: ingredients() }, { shows: 'allergens' });
    expect(label['nutritionMissing']).toBe(false);
  });

  test('"may contain" reaches the label and stays separate', () => {
    const ings = ingredients();
    ings['SUGAR'] = { id: 'SUGAR', name: 'Sugar', allergens: [], mayContain: ['nuts-hazelnut'], allergensCheckedAt: STAMP, nutrition: full() };
    const label = build(recipe('R1', [row('Sugar', 'SUGAR', 100)]), { ingredients: ings });
    expect(label['allergens']).toStrictEqual([]);
    expect(label['mayContain']).toStrictEqual(['nuts-hazelnut']);
  });

  test('junk never throws', () => {
    for (const bad of [null, undefined, {}]) {
      expect(build(bad, {})['ok']).toBe(false);
    }
  });

  // ── The ingredient declaration on the recipe screen (tests/recipe-declaration.test.mjs) ──

  test('⚠️ the list is ordered by weight, heaviest first — the law, not a preference', () => {
    const label = build(DECL_RECIPE, DECL_TABLES);
    expect(label['ok'], 'the fixture must be fully declared, or nothing below means anything').toBe(true);
    expect(label['ingredients'].map((i: Obj) => i['name']),
      'written in the recipe as butter, flour, water — printed heaviest first')
      .toStrictEqual(['Wheat flour', 'Water', 'Butter']);
  });

  test('⚠️ the allergen-bearing rows are marked, and the others are not', () => {
    const label = build(DECL_RECIPE, DECL_TABLES);
    expect(label['ingredients'].map((i: Obj) => i['emphasise']),
      'the regulation asks for the allergen to be emphasised INSIDE the list, not only summarised underneath')
      .toStrictEqual([true, false, true]);
    expect(m.ingredientLine(label), 'and in plain text, where there is no bold, that emphasis is CAPITALS')
      .toMatch(/WHEAT FLOUR/);
  });

  test('⚠️ «may contain» is never merged into «contains»', () => {
    const label = build(DECL_RECIPE, DECL_TABLES);
    expect(m.containsLine(label, 'en')).toMatch(/Wheat/);
    expect(m.containsLine(label, 'en')).toMatch(/Milk/);
    expect(m.containsLine(label, 'en'),
      'a warning that something MIGHT be there is a different statement from a declaration that it IS')
      .not.toMatch(/Hazelnut/);
    expect(m.mayContainLine(label, 'en')).toMatch(/Hazelnut/);
  });

  // ── The language, which is the whole risk of this change ───────────────────

  test('⚠️⚠️ the food words follow the COUNTRY even when the screen disagrees', () => {
    // Two settings that AGREE would pass even if the code read one of them for both, so the
    // declaration is built for an ITALIAN venue with the interface in ENGLISH, and for a UK venue
    // with the interface in ITALIAN. The current app's interface language is a module variable
    // (js/i18n.js); the TypeScript port cannot read one at all, so for it moving that variable
    // proves nothing changes — which is the point.
    const label = build(DECL_RECIPE, DECL_TABLES);
    const before = currentLanguage();
    try {
      // An Italian venue, read by somebody whose app is in English.
      setLanguage('en');
      const italian = m.declarationText(label, outputLanguage({ country: 'IT' }), { withNutrition: false });
      expect(italian, 'the heading is the label’s, not the screen’s').toMatch(/Ingredienti:/);
      expect(italian, 'and so is every ALLERGEN name').toMatch(/Contiene: Grano, Latte/);
      expect(italian).toMatch(/Può contenere: Nocciole/);
      expect(italian,
        '⚠️ an English summary pasted onto Italian packaging is the defect this rule exists to prevent')
        .not.toMatch(/Contains:|May contain:/);

      // And the converse, which is the half that actually proves the two are separate.
      setLanguage('it');
      const english = m.declarationText(label, outputLanguage({ country: 'GB' }), { withNutrition: false });
      expect(english).toMatch(/Ingredients:/);
      expect(english).toMatch(/Contains: Wheat, Milk/);
      expect(english, 'two AGREEING settings would pass even if the code read one of them for both')
        .not.toMatch(/Contiene:|Può contenere:/);
    } finally {
      setLanguage(before);
    }
  });

  test('⚠️⚠️ the INGREDIENT NAMES are the venue’s own words, and stay untranslated', () => {
    // «Wheat flour» in the list is the name somebody typed on the product's record in Orders; an
    // Italian bakery types «Farina di grano tenero» and that is what prints. The app translates the
    // ALLERGEN summary, because those fourteen words are a closed legal vocabulary it owns — and it
    // must NEVER machine-translate a venue's own product names onto a legal document.
    const label = build(DECL_RECIPE, DECL_TABLES);
    const italian = m.declarationText(label, outputLanguage({ country: 'IT' }), { withNutrition: false });
    expect(italian, 'the names come from the ingredient records, verbatim, whatever the country')
      .toMatch(/WHEAT FLOUR, Water, BUTTER/);
  });

  test('⚠️ an unknown country gives no language, and that is answered in English', () => {
    const label = build(DECL_RECIPE, DECL_TABLES);
    // ⚠️ NEVER A BLANK. An empty name in a list of ingredients is the most dangerous
    // thing this screen could draw, because the row still LOOKS complete.
    const text = m.declarationText(label, outputLanguage({ country: 'ZZ' }), { withNutrition: false });
    expect(text).toMatch(/Ingredients:/);
    expect(text).toMatch(/WHEAT FLOUR/);
  });

  // ── What is SENT, and what is not ──────────────────────────────────────────

  test('⚠️ a message leaves the nutrition table out', () => {
    const withTable = { ...build(DECL_RECIPE, DECL_TABLES), nutrition: { kj: 1, kcal: 1, fat: 1, saturates: 1, carbs: 1, sugars: 1, protein: 1, salt: 1 } };
    const message = m.declarationText(withTable, 'en', { withNutrition: false });
    const fullText = m.declarationText(withTable, 'en');
    expect(message, 'some mail clients silently drop a body past about 2000 characters, and the table is most of the length')
      .not.toMatch(/Typical values/);
    expect(fullText, 'the label screen’s own copy still carries it').toMatch(/Typical values/);
    expect(fullText.length).toBeGreaterThan(message.length);
  });

  test('an undeclared recipe produces no text at all', () => {
    const holes = { ...DECL_RECIPE, ingredients: [{ label: 'Mystery', grams: 100, unit: 'g' }] };
    const label = build(holes, DECL_TABLES);
    expect(label['ok']).toBe(false);
    expect(m.declarationText(label, 'en'),
      '⚠️ a list that silently omits the rows nobody has declared is worse than no list, because it looks complete')
      .toBe('');
  });

  // ── Added ──────────────────────────────────────────────────────────────────
  // Not in the original test files: the whole text with its nutrition table, in both languages, and the
  // quirks that the corpus (label-corpus.spec.ts) also pins.

  test('the whole declaration, with the nutrition table, in each language', () => {
    const label = build(bread(), { ingredients: ingredients() });
    expect(m.declarationText(label, 'en')).toBe([
      'Test bread',
      'Ingredients: FLOUR, Water, BUTTER, Salt.',
      'Contains: Wheat, Milk',
      'Typical values per 100 g:',
      '  Energy: 659 kJ',
      '  Energy: 268 kcal',
      '  Fat: 10.1 g',
      '  of which saturates: 6.2 g',
      '  Carbohydrate: 38.5 g',
      '  of which sugars: 2 g',
      '  Protein: 5.3 g',
      '  Salt: 1.43 g',
    ].join('\n'));
    const italian = m.declarationText(label, 'it');
    expect(italian).toMatch(/^Test bread\nIngredienti: FLOUR, Water, BUTTER, Salt\.\nContiene: Grano, Latte\nValori medi per 100 g:\n  Energia: /);
    expect(italian).toMatch(/\n  di cui acidi grassi saturi: /);
    expect(italian).toMatch(/\n  Sale: /);
  });

  test('a recipe with nothing weighable has no ingredients to print, and says so', () => {
    const r = recipe('R1', [{ label: 'Salt', unit: 'to taste', kind: 'ingredient', refId: 'SALT' }]);
    const label = build(r, { ingredients: ingredients() });
    expect(label['ok']).toBe(false);
    expect(label['reason']).toBe('no-ingredients');
    expect(label['gaps']).toStrictEqual([]);
  });

  // ⚠️ QUIRK (Findings C, kept until the current app is fixed): a weightless allergen row — a pinch of
  // mustard — is MISSING from the ingredient list (a row with no weight has no place in a list ordered by
  // weight) but PRESENT in «Contains». The label screen reads its allergens from the allergen walk, which
  // counts every row. Ported AS IS; fixing it is a change to BOTH files at once.
  test('QUIRK (Findings C, kept until the current app is fixed): a weightless allergen row is missing from the ingredient list but present in Contains', () => {
    const ings = { ...ingredients(), MUSTARD: { id: 'MUSTARD', name: 'Mustard', allergens: ['mustard'], allergensCheckedAt: STAMP, nutrition: full() } };
    const r = recipe('R1', [row('Flour', 'FLOUR', 1000),
      { label: 'Mustard', unit: 'pinch', kind: 'ingredient', refId: 'MUSTARD' }]);
    const label = build(r, { ingredients: ings });
    expect(label['ok']).toBe(true);
    expect(label['ingredients'].map((i: Obj) => i['name'])).toStrictEqual(['Flour']);
    expect(label['allergens']).toStrictEqual(['gluten-wheat', 'mustard']);
    expect(m.containsLine(label, 'en')).toBe('Contains: Wheat, Mustard');
    expect(m.ingredientLine(label)).toBe('FLOUR');
  });

  test('an ingredient with no name is printed as «Unnamed ingredient» (the original’s English fallback, kept for parity)', () => {
    const ings = { NONAME: { id: 'NONAME', allergens: [], allergensCheckedAt: STAMP } };
    const label = build(recipe('R1', [row('x', 'NONAME', 100)]), { ingredients: ings });
    expect(label['ingredients'].map((i: Obj) => i['name'])).toStrictEqual(['Unnamed ingredient']);
  });

  test('the language argument defaults to English, and only an exact «it» is Italian', () => {
    const label = build(bread(), { ingredients: ingredients() });
    expect(m.containsLine(label)).toBe('Contains: Wheat, Milk');
    expect(m.containsLine(label, 'it')).toBe('Contiene: Grano, Latte');
    for (const lang of ['IT', 'de', null, '', 'it ']) {
      expect(m.containsLine(label, lang), String(lang)).toBe('Contains: Wheat, Milk');
    }
  });

  test('a refused label answers an empty line from every text function', () => {
    const refused = build(null, {});
    for (const lang of ['en', 'it']) {
      expect(m.containsLine(refused, lang)).toBe('');
      expect(m.mayContainLine(refused, lang)).toBe('');
      expect(m.declarationText(refused, lang)).toBe('');
    }
    expect(m.ingredientLine(refused)).toBe('');
  });
});
