// Unit tests for the part of the recipe catalogue's model that Food cost reads (P15 — the owner cannot
// read code, so these tests are the safety net), run against BOTH implementations: the TypeScript port in
// shared/ and js/catalogue/catalogue-model.js, which the live app uses today. Ported from
// tests/catalogue-model.test.mjs, tests/link-suggestions.test.mjs and tests/recipe-cost-model.test.mjs;
// the two must stay equal until the switch to Mise 2.
//
// catalogue-model.ts is a PARTIAL port, so parity.spec.ts does not pair it: the original also holds the
// Calculator import. The last block of this file stands in for
// what pairing would have checked: the same names (plus the two the port adds, `unitTextKey` and `nameTaken`), the same
// constants, the same frozen-ness, the same function shapes (`batchWarning` excepted: it takes the translator).
//
// PORTED from tests/catalogue-model.test.mjs: 'unitOf / isWeighableUnit / weighableTotalGrams', the weighing
// tests ('two weighings become a percentage', '⚠️ the number SHOWN is the number STORED…', '⚠️⚠️ nothing gains
// weight in an oven…', '⚠️⚠️ a cooked weight of almost nothing is capped at 99…', '⚠️ an unanswered pair is
// null…', 'junk in, no throw and no NaN out') and, since step 3d-1, every test of the normalisers, the kg
// scaling, formatWeight, batchWarning (THE INCIDENT), isScaledEntryFresh, sortByUsage and filterByName;
// from tests/recipe-weights.test.mjs: '⚠️⚠️ a recipe with no shelf life stays WITHOUT one — absent is not
// zero' and 'labelFieldsOf'; from tests/guided-model.test.mjs the «row id survives the trip» property; from
// tests/recipe-cost-model.test.mjs 'normalising a recipe keeps its ingredient links' (and the no-link shape);
// from tests/link-suggestions.test.mjs: every test of suggestLinks and the suggestLinks half of '⚠️ packaging
// is never offered as a recipe ingredient'; from tests/recipe-unit-text.test.mjs the language tests, adapted
// to `unitTextKey` (the data-word and screen-source tests stay in the original's own suite). Added:
// normalizeSearchText, ingredientGrams (including the copied quirk) and the constants.
//
// `batchWarning` is run with the interface dictionary's own `t` handed to the port as the translator, which
// is exactly the words the original reads for itself.
//
// PORTED since step 3d-6: from tests/catalogue-model.test.mjs every test of findInvalidRecipe and
// findCalculatorImport; from tests/link-suggestions.test.mjs every applyLink test, the linkOptions half of
// '⚠️ packaging is never offered…', 'linkedItemName: the one name…' and '⚠️ choosing the link a row already
// has…'; from tests/catalogue-reorder.test.mjs the three moveRow tests; from tests/ingredient-name.test.mjs the
// linkOptions test; and `nameTaken` (tests/record-cards-shared.test.mjs and tests/ingredient-name.test.mjs,
// plus the cases of its doc comment), run against the port and against js/catalogue/ingredient-suggest.js.
//
// NOT PORTED — the rest of the original: toCalculatorRecipe, nonWeighableLabels, mergeImportedRecipe
// (tests/catalogue-model.test.mjs; step 3d-7), and the tests that read the screens' source, the precache or the
// dictionary words.

import { describe, expect, test } from 'vitest';
import * as ported from './catalogue-model';
import * as legacyJs from '../../js/catalogue/catalogue-model.js';
import { nameTaken as legacyNameTaken } from '../../js/catalogue/ingredient-suggest.js';
import { DATA_WORDS, DEFAULT_LANGUAGE, _dictionaries, setLanguage, t } from '../../js/i18n.js';

const legacy = legacyJs as unknown as typeof ported;

const SUPPLIERS = { S1: { name: 'Brava Fresh' }, S2: { name: 'Latteria' } };
const INGREDIENTS = {
  B1: { id: 'B1', name: 'Burro Occelli', weight: '1 kg', supplierId: 'S1' },
  B2: { id: 'B2', name: 'Burro chiarificato', weight: '500 g', supplierId: 'S2' },
  P1: { id: 'P1', name: 'Pasta sfoglia al burro', supplierId: 'S1' },
  F1: { id: 'F1', name: 'Farina 00', supplierId: 'S1' },
  OLD: { id: 'OLD', name: 'Burro vecchio', active: false },
  CR: { id: 'CR', name: 'Crème fraîche', supplierId: 'S2' },
};
const RECIPES = [
  { id: 'R1', name: 'Crema al burro' },
  { id: 'SELF', name: 'Burro montato' },
];
const base = (over: Record<string, unknown> = {}): ported.SuggestOptions => ({
  ingredients: INGREDIENTS, recipes: RECIPES, suppliers: SUPPLIERS, excludeRecipeId: 'SELF', ...over,
});

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const names = (result: { items: { name: string }[] }): string[] => result.items.map(i => i.name);

  // ── Units ──────────────────────────────────────────────────────────────────

  test('unitOf / isWeighableUnit / weighableTotalGrams', () => {
    expect(m.unitOf({ grams: 1 })).toBe('g');                 // legacy row -> grams
    expect(m.unitOf({ grams: 1, unit: 'kg' })).toBe('kg');
    expect(m.unitOf({ grams: 1, unit: 'nope' })).toBe('g');   // unknown -> grams
    expect(m.isWeighableUnit('kg')).toBe(true);
    expect(m.isWeighableUnit('l')).toBe(true);
    expect(m.isWeighableUnit('pcs')).toBe(false);
    expect(m.isWeighableUnit('to taste')).toBe(false);
    // 1 kg (1000) + 500 g + 0.5 l (500) + 3 pcs (0) = 2000 g weighable
    expect(m.weighableTotalGrams({ ingredients: [
      { label: 'A', grams: 1, unit: 'kg' }, { label: 'B', grams: 500, unit: 'g' },
      { label: 'C', grams: 0.5, unit: 'l' }, { label: 'D', grams: 3, unit: 'pcs' },
    ] })).toBe(2000);
  });

  test('every weighable unit converts to grams, volume at 1 ml = 1 g; the rest weigh nothing', () => {
    const grams = (unit: string): number => m.ingredientGrams({ grams: 2, unit });
    expect(grams('g')).toBe(2);
    expect(grams('kg')).toBe(2000);
    expect(grams('mg')).toBe(0.002);
    expect(grams('ml')).toBe(2);
    expect(grams('cl')).toBe(20);
    expect(grams('dl')).toBe(200);
    expect(grams('l')).toBe(2000);
    for (const unit of ['pcs', 'tsp', 'tbsp', 'pinch', 'to taste']) expect(grams(unit), unit).toBe(0);
    expect(m.ingredientGrams({ grams: 'abc', unit: 'kg' }), 'a non-number weighs nothing, never NaN').toBe(0);
    expect(m.ingredientGrams({ unit: 'kg' })).toBe(0);
  });

  test('the weighable total of nothing is 0', () => {
    for (const odd of [null, undefined, {}, { ingredients: 'x' }, { ingredients: [] }, 5]) {
      expect(m.weighableTotalGrams(odd), String(odd)).toBe(0);
    }
  });

  test('the unit table is the one the editor offers', () => {
    expect(m.CATALOGUE_UNITS).toStrictEqual(['g', 'kg', 'mg', 'ml', 'cl', 'dl', 'l', 'pcs', 'tsp', 'tbsp', 'pinch', 'to taste']);
    expect(m.DEFAULT_UNIT).toBe('g');
  });

  // ── The link of a row ──────────────────────────────────────────────────────

  test('a junk link is treated as no link, never as a link to nothing', () => {
    expect(m.linkOf({ refId: '' })).toBe(null);
    expect(m.linkOf({ refId: '   ' })).toBe(null);
    expect(m.linkOf({})).toBe(null);
    expect(m.linkOf(null)).toBe(null);
    // An unknown kind falls back to 'ingredient', which is what every link the editor writes is unless it
    // says otherwise.
    expect(m.linkOf({ refId: 'X', kind: 'nonsense' })).toStrictEqual({ kind: 'ingredient', refId: 'X' });
  });

  test('a link keeps its kind, and a number id is read as text', () => {
    expect(m.linkOf({ refId: ' R1 ', kind: 'recipe' })).toStrictEqual({ kind: 'recipe', refId: 'R1' });
    expect(m.linkOf({ refId: 7 })).toStrictEqual({ kind: 'ingredient', refId: '7' });
    expect([...m.ROW_KINDS]).toStrictEqual(['ingredient', 'recipe']);
  });

  // ── The loss ───────────────────────────────────────────────────────────────

  test('a loss of 100% cannot divide the price by zero: it is capped at 99', () => {
    expect(m.normalizeLossPct(100)).toBe(m.MAX_LOSS_PCT);
    expect(m.normalizeLossPct(1000)).toBe(m.MAX_LOSS_PCT);
    expect(m.MAX_LOSS_PCT).toBe(99);
  });

  test('a nonsense loss is treated as none', () => {
    for (const bad of [undefined, null, '', 'abc', NaN, -5, -0.1]) {
      expect(m.normalizeLossPct(bad), String(bad)).toBe(0);
    }
    expect(m.normalizeLossPct('12.5')).toBe(12.5);
  });

  test('two weighings become a percentage', () => {
    expect(m.weightLoss(1000, 800).pct).toBe(20);
    expect(m.weightLoss(8380, 7374).pct).toBe(12);      // rounded to a tenth: 12.005 → 12
    expect(m.weightLoss(1000, 1000).pct).toBe(0);       // nothing lost IS an answer
    expect(m.weightLoss(1000, 800).problem).toBe(null);
  });

  test('⚠️ the number SHOWN is the number STORED — rounded to a tenth', () => {
    // 12.005% displayed as 12% while 12.005 sits in the database is a screen nobody can reconcile against
    // the figure it is supposed to explain.
    const { pct } = m.weightLoss(8380, 7373);
    expect(pct).toBe(12.0);
    expect(Math.round((pct as number) * 10) / 10, 'never more than one decimal').toBe(pct);
    expect(m.weightLoss(3000, 2555).pct).toBe(14.8);
  });

  test('⚠️⚠️ nothing gains weight in an oven, and that is NOT answered with zero', () => {
    // Zero would quietly turn a typo into «this recipe loses nothing» — the exact direction that makes a
    // product look cheaper than it is.
    const out = m.weightLoss(800, 1000);
    expect(out.pct).toBe(null);
    expect(out.problem).toBe('cookedHeavier');
  });

  test('⚠️⚠️ a cooked weight of almost nothing is capped at 99, and says so', () => {
    // 100 would divide the price per kilo by zero and make every product built on this recipe cost
    // Infinity. The cap is load-bearing, and the screen has to admit it rather than silently storing
    // something other than what was typed.
    const out = m.weightLoss(8380, 1);
    expect(out.pct).toBe(m.MAX_LOSS_PCT);
    expect(out.problem).toBe('capped');
    expect(out.pct as number).toBeLessThan(100);
  });

  test('⚠️ an unanswered pair is null, which is NOT zero', () => {
    // null means «these two numbers do not answer the question», and the editor must leave the recipe's
    // stored loss alone. Zero would overwrite it with «loses nothing».
    for (const [a, b] of [[0, 0], [1000, 0], [0, 800], ['', ''], [1000, ''], [null, null],
      ['abc', 'def'], [-5, 800], [1000, -5], [undefined, undefined]]) {
      const out = m.weightLoss(a, b);
      expect(out.pct, `weightLoss(${JSON.stringify(a)}, ${JSON.stringify(b)})`).toBe(null);
      expect(out.problem, 'an empty pair is not a MISTAKE, it is just unanswered').toBe(null);
    }
  });

  test('junk in, no throw and no NaN out', () => {
    for (const junk of [NaN, Infinity, -Infinity, {}, [], 'x', null, undefined]) {
      expect(m.normalizeWeight(junk)).toBe(0);
      expect(m.weightLoss(junk, junk).pct).toBe(null);
    }
    expect(m.normalizeWeight(1e12), 'bounded, so a runaway never reaches the database').toBe(m.MAX_WEIGHT_G);
    expect(m.normalizeWeight('850'), 'a string from an input box is a number').toBe(850);
  });

  // ── Search text ────────────────────────────────────────────────────────────

  test('normalizeSearchText lowers the case and strips accents, so «però» is found by «pero»', () => {
    expect(m.normalizeSearchText('  Però CRÈME fraîche ')).toBe('pero creme fraiche');
    expect(m.normalizeSearchText(null)).toBe('');
    expect(m.normalizeSearchText(undefined)).toBe('');
    expect(m.normalizeSearchText(5)).toBe('5');
  });

  // ── Suggesting a link while a name is typed ────────────────────────────────

  test('nothing is offered below two characters', () => {
    expect(m.SUGGEST_MIN_CHARS).toBe(2);
    for (const query of ['', 'b', ' b ', null, undefined]) {
      expect(m.suggestLinks(base({ query })), String(query)).toStrictEqual({ items: [], total: 0 });
    }
    expect(m.suggestLinks(base({ query: 'bu' })).items.length).toBeGreaterThan(0);
  });

  test('«burro» offers the butters first, then a product with a butter word, then recipes', () => {
    const out = m.suggestLinks(base({ query: 'burro' }));
    expect(names(out)).toStrictEqual([
      'Burro chiarificato', 'Burro Occelli',   // the name starts with it
      'Pasta sfoglia al burro',                // one of its words does
      'Crema al burro',                        // a recipe, after every ingredient
    ]);
    expect(out.total).toBe(4);
  });

  test('starts-with, then a word that starts with it, then anywhere inside', () => {
    const ingredients = {
      a: { id: 'a', name: 'Insalata' },
      b: { id: 'b', name: 'Olio di semi al sale' },
      c: { id: 'c', name: 'Salmone' },
      d: { id: 'd', name: 'Sale fino' },
    };
    expect(names(m.suggestLinks({ ingredients, recipes: [], query: 'sal' })))
      .toStrictEqual(['Sale fino', 'Salmone', 'Olio di semi al sale', 'Insalata']);
  });

  test('accents and capitals do not matter', () => {
    for (const query of ['creme', 'CRÈME', 'crème fr']) {
      expect(names(m.suggestLinks(base({ query }))), query).toStrictEqual(['Crème fraîche']);
    }
  });

  test('⚠️ the NAME only — not the supplier, not the pack weight', () => {
    // The full chooser searches those too; a name being typed must not bring up a supplier's whole range.
    expect(m.suggestLinks(base({ query: 'brava' })).items).toStrictEqual([]);
    expect(m.suggestLinks(base({ query: 'latteria' })).items).toStrictEqual([]);
    expect(m.suggestLinks(base({ query: '500 g' })).items).toStrictEqual([]);
  });

  test('a deactivated ingredient and the recipe being edited are never offered', () => {
    const all = names(m.suggestLinks(base({ query: 'bu', limit: 50 })));
    expect(all.includes('Burro vecchio'), 'nobody buys it any more').toBe(false);
    expect(all.includes('Burro montato'), 'a recipe cannot be made of itself').toBe(false);
  });

  test('at most five, with the total so the rest can be offered', () => {
    expect(m.SUGGEST_LIMIT).toBe(5);
    const ingredients: Record<string, { id: string; name: string }> = {};
    for (let i = 0; i < 12; i++) ingredients[`X${i}`] = { id: `X${i}`, name: `Zucchero ${i}` };
    const out = m.suggestLinks({ ingredients, recipes: [], query: 'zucchero' });
    expect(out.items.length).toBe(5);
    expect(out.total).toBe(12);
    expect(m.suggestLinks({ ingredients, recipes: [], query: 'zucchero', limit: 3 }).items.length).toBe(3);
    expect(m.suggestLinks({ ingredients, recipes: [], query: 'zucchero', limit: 'junk' }).items.length).toBe(5);
  });

  test('ingredients come before recipes even when a recipe matches better', () => {
    const out = m.suggestLinks({
      ingredients: { i: { id: 'i', name: 'Pane al miele' } },
      recipes: [{ id: 'r', name: 'Miele caramellato' }],
      query: 'miele',
    });
    expect(out.items.map(i => i.kind)).toStrictEqual(['ingredient', 'recipe']);
  });

  test('each suggestion carries what the screen shows, and a tick on the current link', () => {
    const out = m.suggestLinks(base({ query: 'burro', linked: { kind: 'ingredient', refId: 'B1' } }));
    const occelli = out.items.find(i => i.refId === 'B1');
    expect(occelli).toStrictEqual({
      kind: 'ingredient', refId: 'B1', name: 'Burro Occelli', displayName: 'Burro Occelli', weight: '1 kg', supplierName: 'Brava Fresh', linked: true,
    });
    expect(out.items.filter(i => i.linked).length, 'only the row’s own link is ticked').toBe(1);
    expect(m.suggestLinks(base({ query: 'burro', linked: { kind: 'recipe', refId: 'B1' } }))
      .items.filter(i => i.linked).length, 'the same id of the other kind is not the link').toBe(0);
  });

  test('a short name is what the list shows and is searched, the invoice name still is too', () => {
    const ingredients = { B1: { id: 'B1', name: 'Burro Président', shortName: 'Burro P.' } };
    const byShort = m.suggestLinks({ ingredients, recipes: [], query: 'burro p' });
    expect(byShort.items.map(i => [i.name, i.displayName])).toStrictEqual([['Burro Président', 'Burro P.']]);
    expect(m.suggestLinks({ ingredients, recipes: [], query: 'presid' }).total).toBe(1);
  });

  test('a supplier’s short name is the one shown beside a suggestion', () => {
    const suppliers = { S1: { name: 'Aldo Legacy Foods Ltd Wholesale', shortName: 'Aldo' } };
    const out = m.suggestLinks({ ingredients: { B: { id: 'B', name: 'Burro', supplierId: 'S1' } }, recipes: [], suppliers, query: 'burro' });
    expect(out.items[0]?.supplierName).toBe('Aldo');
  });

  test('⚠️ packaging is never offered as a recipe ingredient', () => {
    // An item filed under «Imballaggi» in Fornitori e ingredienti is a box, not food: linked to a recipe
    // row it would read as an ingredient with no allergens declared.
    const ingredients = {
      ...INGREDIENTS,
      BOX: { id: 'BOX', name: 'Burro box', kind: 'packaging', supplierId: 'S1' },
    };
    expect(names(m.suggestLinks({ ingredients, recipes: [], query: 'burro' })).includes('Burro box')).toBe(false);
    expect(names(m.suggestLinks({ ingredients, recipes: [], query: 'burro' })).includes('Burro Occelli')).toBe(true);
  });

  test('recipes may arrive as an object keyed by id as well as a list', () => {
    const out = m.suggestLinks({ ingredients: {}, recipes: { R1: { id: 'R1', name: 'Crema al burro' } }, query: 'crema' });
    expect(out.items.map(i => i.refId)).toStrictEqual(['R1']);
  });

  // ── The recipe, normalised (step 3d-1) ─────────────────────────────────────

  const FOCACCIA = {
    id: 'foc',
    name: 'Focaccia',
    ingredients: [
      { label: 'Flour uniqua blue', grams: 278 }, { label: 'Flour T65', grams: 278 }, { label: 'Malt', grams: 3 },
      { label: 'Sugar', grams: 8 }, { label: 'Salt', grams: 11 }, { label: 'Yeast', grams: 3.6 }, { label: 'Oil', grams: 56 },
      { label: '1° Water', grams: 334 }, { label: '2° Water', grams: 24 },
    ],
  };
  const sum = (arr: readonly (number | null)[]): number => arr.reduce<number>((a, b) => a + (b ?? 0), 0);

  test('normalizeCatalogueRecipe coerces junk safely (never NaN, never throws)', () => {
    const r = m.normalizeCatalogueRecipe({
      id: 42, name: '  Ciabatta  ',
      ingredients: [
        { label: 'Flour', grams: '500' },            // numeric string
        { name: 'Water', grams: -5 },                 // legacy `name`, negative -> 0
        { label: 'Salt', grams: 'abc' },              // non-numeric -> 0
        { label: 'Milk', grams: 2, unit: 'l' },       // valid unit preserved
        { label: 'Eggs', grams: 3, unit: 'pcs' },     // valid unit preserved
        { label: 'Bad', grams: 1, unit: 'xyz' },      // unknown unit -> grams
        null,                                          // dropped
        'garbage',                                     // dropped
      ],
    });
    expect(r?.id).toBe('42');
    expect(r?.name).toBe('Ciabatta');
    expect(r?.ingredients).toStrictEqual([
      { label: 'Flour', grams: 500, unit: 'g' },
      { label: 'Water', grams: 0, unit: 'g' },
      { label: 'Salt', grams: 0, unit: 'g' },
      { label: 'Milk', grams: 2, unit: 'l' },
      { label: 'Eggs', grams: 3, unit: 'pcs' },
      { label: 'Bad', grams: 1, unit: 'g' },
    ]);
  });

  test('normalizeCatalogueRecipe returns null for non-object input', () => {
    expect(m.normalizeCatalogueRecipe(null)).toBe(null);
    expect(m.normalizeCatalogueRecipe('x')).toBe(null);
  });

  test('normalizeCatalogueRecipes drops junk entries', () => {
    const list = m.normalizeCatalogueRecipes([FOCACCIA, null, 5, { name: 'X' }]);
    expect(list.length).toBe(2);
    expect(list[0]?.name).toBe('Focaccia');
    expect(list[1]?.name).toBe('X');
    expect(m.normalizeCatalogueRecipes('nope')).toStrictEqual([]);
  });

  test('normalising a recipe keeps its ingredient links', () => {
    // normalizeIngredient rebuilds every row, so a field it does not mention is dropped on the way in from
    // Firestore — and opening a recipe to fix a typo would wipe every link.
    const stored = { id: 'R1', name: 'Bread', lossPct: 12, ingredients: [
      { label: 'Flour', grams: 800, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
      { label: 'Cream', grams: 200, unit: 'g', kind: 'recipe', refId: 'CREAM' },
    ] };
    const out = m.normalizeCatalogueRecipe(stored);
    expect(out?.ingredients[0]).toStrictEqual({ label: 'Flour', grams: 800, unit: 'g', kind: 'ingredient', refId: 'FLOUR' });
    expect(out?.ingredients[1]).toStrictEqual({ label: 'Cream', grams: 200, unit: 'g', kind: 'recipe', refId: 'CREAM' });
    expect(out?.lossPct).toBe(12);
  });

  test('a row with no link stays exactly the shape it has always had', () => {
    const out = m.normalizeCatalogueRecipe({ id: 'R1', name: 'Old', ingredients: [{ label: 'Flour', grams: 500, unit: 'g' }] });
    expect(out?.ingredients[0]).toStrictEqual({ label: 'Flour', grams: 500, unit: 'g' });
  });

  test('⚠️ the row id survives the trip, trimmed, and is never minted', () => {
    // `rid` is the stable id a guided mixing step points at: dropped here, every step would be unhooked.
    const out = m.normalizeCatalogueRecipe({ id: 'r', name: 'B', ingredients: [
      { rid: ' ra ', label: 'Flour', grams: 1000, unit: 'g' }, { label: 'Water', grams: 500 }, { rid: '  ', label: 'Salt', grams: 5 }, { rid: 7, label: 'Oil', grams: 1 },
    ] });
    expect(out?.ingredients.map(row => row.rid)).toStrictEqual(['ra', undefined, undefined, '7']);
    expect('rid' in (out?.ingredients[1] ?? {}), 'no rid key at all on a row without one').toBe(false);
    expect(out?.ingredients[0]).toStrictEqual({ label: 'Flour', grams: 1000, unit: 'g', rid: 'ra' });
  });

  test('the guided procedure is carried as stored, and absent when there is none', () => {
    const steps = [{ id: 's1', text: 'Mix' }];
    expect(m.normalizeCatalogueRecipe({ id: 'r', name: 'B', steps, endNote: 'Done' })).toMatchObject({ steps, endNote: 'Done' });
    const bare = m.normalizeCatalogueRecipe({ id: 'r', name: 'B', steps: [], endNote: '   ' });
    expect('steps' in (bare ?? {})).toBe(false);
    expect('endNote' in (bare ?? {})).toBe(false);
  });

  test('⚠️ the weights are absent, not zero, on a recipe nobody has weighed', () => {
    const plain = m.normalizeCatalogueRecipe({ id: 'r', name: 'Bread', ingredients: [], lossPct: 12 });
    expect('rawGrams' in (plain ?? {}), 'no rawGrams key at all').toBe(false);
    expect('cookedGrams' in (plain ?? {}), 'no cookedGrams key at all').toBe(false);
    expect(plain?.lossPct, 'and its stored loss is untouched').toBe(12);

    const weighed = m.normalizeCatalogueRecipe({ id: 'r', name: 'Bread', ingredients: [], lossPct: 20, rawGrams: 1000, cookedGrams: 800 });
    expect(weighed?.rawGrams).toBe(1000);
    expect(weighed?.cookedGrams).toBe(800);
  });

  test('⚠️⚠️ a recipe with no shelf life stays WITHOUT one — absent is not zero', () => {
    const bare = m.normalizeCatalogueRecipe({ id: 'r', name: 'Bread', ingredients: [] });
    expect('shelfLifeDays' in (bare ?? {}), 'a recipe nobody has told must not gain the key').toBe(false);
    expect('netWeightG' in (bare ?? {}), 'nor a weight nobody weighed').toBe(false);

    expect(m.normalizeShelfLifeDays(undefined)).toBe(null);
    expect(m.normalizeShelfLifeDays(null)).toBe(null);
    expect(m.normalizeShelfLifeDays('')).toBe(null);
    expect(m.normalizeShelfLifeDays('   ')).toBe(null);
    expect(m.normalizeShelfLifeDays(true), 'a boolean is not a number of days: Number(true) is 1').toBe(null);
    expect(m.normalizeShelfLifeDays(-1)).toBe(null);
    expect(m.normalizeShelfLifeDays(99999)).toBe(null);
    expect(m.normalizeShelfLifeDays(0), 'a real zero, typed on purpose, is «today» and is kept').toBe(0);
    expect(m.normalizeShelfLifeDays('7')).toBe(7);
    expect(m.normalizeShelfLifeDays(m.MAX_SHELF_LIFE_DAYS)).toBe(3650);
    expect(m.normalizeShelfLifeDays(m.MAX_SHELF_LIFE_DAYS + 1)).toBe(null);
    expect(m.normalizeCatalogueRecipe({ id: 'r', name: 'B', ingredients: [], shelfLifeDays: 0 })?.shelfLifeDays).toBe(0);
  });

  test('labelFieldsOf: a number, or null for «nobody has said» — never 0 for a shelf life nobody typed', () => {
    expect(m.labelFieldsOf({ netWeightG: 250, shelfLifeDays: 3 })).toStrictEqual({ netWeightG: 250, shelfLifeDays: 3 });
    expect(m.labelFieldsOf({ netWeightG: '250', shelfLifeDays: '0' }), 'a shelf life of 0 is a real answer and must be kept')
      .toStrictEqual({ netWeightG: 250, shelfLifeDays: 0 });
    expect(m.labelFieldsOf({})).toStrictEqual({ netWeightG: null, shelfLifeDays: null });
    expect(m.labelFieldsOf({ netWeightG: 0, shelfLifeDays: '' }), 'an emptied box is a removal').toStrictEqual({ netWeightG: null, shelfLifeDays: null });
    expect(m.labelFieldsOf({ netWeightG: -5, shelfLifeDays: true }), 'junk is not a number of grams or days').toStrictEqual({ netWeightG: null, shelfLifeDays: null });
    expect(m.labelFieldsOf(null)).toStrictEqual({ netWeightG: null, shelfLifeDays: null });
  });

  // ── scaleCatalogue: the core invariant (integers sum EXACTLY to the target) ──

  test('scaleCatalogue keeps the base recipe when target equals its total', () => {
    const total = FOCACCIA.ingredients.reduce((s, i) => s + i.grams, 0); // 995.6 (raw, fractional)
    expect(sum(m.scaleCatalogue(FOCACCIA, total))).toBe(Math.round(total));
  });

  test('baseAmounts rounds to whole grams that sum to the rounded base total', () => {
    const out = m.baseAmounts(FOCACCIA);
    expect(out.every(Number.isInteger), 'every base amount is a whole number').toBe(true);
    const rawTotal = FOCACCIA.ingredients.reduce((s, i) => s + i.grams, 0); // 995.6
    expect(sum(out), 'rows add up to the shown total').toBe(Math.round(rawTotal)); // 996
  });

  test('baseAmounts on an empty recipe is []', () => {
    expect(m.baseAmounts({ ingredients: [] })).toStrictEqual([]);
  });

  test('scaleCatalogue to 10 kg: proportional and sums to exactly 10000 g', () => {
    const out = m.scaleCatalogue(FOCACCIA, 10000);
    expect(sum(out)).toBe(10000);
    expect(out[0]).toBe(out[1]);
    expect((out[0] as number) > 2700 && (out[0] as number) < 2900).toBe(true);
  });

  test('scaleCatalogue sums to target across many weights (rounding residual absorbed)', () => {
    for (const kg of [0.5, 1, 3, 7, 12.5, 33]) {
      expect(sum(m.scaleCatalogue(FOCACCIA, kg * 1000)), `sum must equal target for ${kg} kg`).toBe(Math.round(kg * 1000));
    }
  });

  test('scaleCatalogue is defensive: empty recipe / non-positive / bad target -> zeros', () => {
    expect(m.scaleCatalogue({ ingredients: [] }, 10000)).toStrictEqual([]);
    expect(m.scaleCatalogue(FOCACCIA, 0).every(x => x === 0)).toBe(true);
    expect(m.scaleCatalogue(FOCACCIA, -5).every(x => x === 0)).toBe(true);
    expect(m.scaleCatalogue(FOCACCIA, NaN).every(x => x === 0)).toBe(true);
    expect(m.scaleCatalogue(null, 10000)).toStrictEqual([]);
  });

  test('scaleCatalogue mixed units: weighable + pieces scale by the same factor', () => {
    const recipe = { ingredients: [
      { label: 'Flour', grams: 1000, unit: 'g' }, { label: 'Eggs', grams: 2, unit: 'pcs' }, { label: 'Salt', grams: 0, unit: 'to taste' },
    ] };
    expect(m.scaleCatalogue(recipe, 2000)).toStrictEqual([2000, 4, null]); // factor 2; to-taste has no number
    expect(m.scaleCatalogue(recipe, 0), 'to taste stays null even when nothing can be scaled').toStrictEqual([0, 0, null]);
  });

  test('scaleCatalogue mixed: kg + l convert into the weighable total, then scale', () => {
    const recipe = { ingredients: [{ label: 'Flour', grams: 1, unit: 'kg' }, { label: 'Water', grams: 1, unit: 'l' }] };
    expect(m.scaleCatalogue(recipe, 4000)).toStrictEqual([2, 2]); // factor 2 -> 2 kg, 2 l
  });

  test('baseAmounts with non-weight units: whole numbers in each unit, null for to-taste', () => {
    expect(m.baseAmounts({ ingredients: [
      { label: 'Flour', grams: 500.4, unit: 'g' }, { label: 'Eggs', grams: 2, unit: 'pcs' }, { label: 'Salt', grams: 0, unit: 'to taste' },
    ] })).toStrictEqual([500, 2, null]);
  });

  test('isScaledEntryFresh: valid within 12h, expired after, junk-safe', () => {
    const now = 1_000_000_000_000;
    expect(m.isScaledEntryFresh({ target: 10000, ts: now - 1000 }, now)).toBe(true);
    expect(m.isScaledEntryFresh({ target: 10000, ts: now - (m.SCALED_TTL_MS - 1) }, now), 'just under 12h').toBe(true);
    expect(m.isScaledEntryFresh({ target: 10000, ts: now - m.SCALED_TTL_MS }, now), 'exactly 12h is stale').toBe(false);
    expect(m.isScaledEntryFresh({ target: 10000, ts: now - (m.SCALED_TTL_MS + 1) }, now)).toBe(false);
    expect(m.isScaledEntryFresh(null, now)).toBe(false);
    expect(m.isScaledEntryFresh({ target: 0, ts: now }, now), 'non-positive target').toBe(false);
    expect(m.isScaledEntryFresh({ target: 5000 }, now), 'missing ts').toBe(false);
    expect(m.SCALED_TTL_MS).toBe(43200000);
  });

  // ── sortByUsage / filterByName ──────────────────────────────────────────────

  test('sortByUsage: open-count desc, then name asc; does not mutate input', () => {
    const recipes = [{ id: 'a', name: 'Brioche' }, { id: 'b', name: 'Focaccia' }, { id: 'c', name: 'Sourdough' }];
    const snapshot = recipes.slice();
    const sorted = m.sortByUsage(recipes, { b: 5, c: 5, a: 1 });
    expect(sorted.map(r => r.id), 'b,c tie on 5 -> name asc').toStrictEqual(['b', 'c', 'a']);
    expect(recipes, 'original untouched').toStrictEqual(snapshot);
  });

  test('sortByUsage: missing counts treated as 0', () => {
    const sorted = m.sortByUsage([{ id: 'x', name: 'Zebra' }, { id: 'y', name: 'Apple' }], {});
    expect(sorted.map(r => r.name)).toStrictEqual(['Apple', 'Zebra']);
    expect(m.sortByUsage([{ id: 'x', name: 'Zebra' }, { id: 'y', name: 'Apple' }]).map(r => r.name)).toStrictEqual(['Apple', 'Zebra']);
  });

  test('filterByName: case-insensitive substring; empty query returns all', () => {
    const recipes = [{ name: 'Focaccia' }, { name: 'Brioche' }, { name: 'Sourdough' }];
    expect(m.filterByName(recipes, 'bri').map(r => r.name)).toStrictEqual(['Brioche']);
    expect(m.filterByName(recipes, 'O').length).toBe(3);
    expect(m.filterByName(recipes, '   ').length).toBe(3);
    expect(m.filterByName(recipes, '')).toBe(recipes);
  });

  // ── Batch size: readable weight + the mistyped-total guard ──────────────────
  // The real incident: the field took KILOGRAMS while every row read in grams, so typing 17500 (meaning 17500 g)
  // silently produced a 17.5-tonne batch. Sums to 14153 g, NOT the 14000 g (4 x 3500) its name promises.

  const CROISSANT = m.normalizeCatalogueRecipe({
    id: 'croissant', name: 'Croissant (4 x 3500gr.)',
    ingredients: [
      { label: 'Flour T45', grams: 7360, unit: 'g' }, { label: 'Caster sugar', grams: 955, unit: 'g' }, { label: 'Salt', grams: 148, unit: 'g' },
      { label: 'Fresh yeast', grams: 295, unit: 'g' }, { label: 'Fresh milk', grams: 1470, unit: 'g' }, { label: 'Water', grams: 1950, unit: 'g' },
      { label: 'Butter', grams: 505, unit: 'g' }, { label: 'Croissant scraps', grams: 1470, unit: 'g' },
    ],
  });
  // The interface dictionary in English: the original reads it itself, the port is handed it.
  const tr: ported.BatchWarningTranslate = (key, params) => t(key, params as Record<string, string | number>);
  const warn = (target: unknown, base: unknown): string | null => m.batchWarning(target, base, tr);

  test('the croissant weighs what its ingredients say (14153 g), not what its name says', () => {
    expect(m.weighableTotalGrams(CROISSANT)).toBe(14153);
  });

  test('formatWeight: names a weight the way a person would say it', () => {
    expect(m.formatWeight(500)).toBe('500 g');
    expect(m.formatWeight(17500)).toBe('17.5 kg');
    expect(m.formatWeight(18000), 'no trailing .0').toBe('18 kg');
    expect(m.formatWeight(17500000)).toBe('17.5 tonnes');
    expect(m.formatWeight(0)).toBe('0 g');
    expect(m.formatWeight('junk'), 'never NaN').toBe('0 g');
  });

  test('batchWarning: a normal batch passes without a warning', () => {
    const base = m.weighableTotalGrams(CROISSANT);
    expect(warn(17500, base)).toBe(null);
    expect(warn(base, base)).toBe(null);
    expect(warn(0, base), 'an empty field is not a warning').toBe(null);
  });

  test('batchWarning: THE INCIDENT — a tonne-scale total is flagged, not scaled in silence', () => {
    const base = m.weighableTotalGrams(CROISSANT);
    const w = warn(17500000, base); // what "17500 kg" used to mean
    expect(w, 'a 17.5-tonne batch must warn').toBeTruthy();
    expect(w).toMatch(/17\.5 tonnes/);
    expect(w).toMatch(/1236\.49×/);   // 17500000 / 14153
    expect(w).toMatch(/14\.15 kg/);   // compared against the recipe as written
    expect(w).toBe('That is 17.5 tonnes of dough — 1236.49× the recipe as written (14.15 kg). Check the amount before calculating.');
  });

  test('batchWarning: one extra zero (175 kg instead of 17.5 kg) is caught too', () => {
    const w = warn(175000, m.weighableTotalGrams(CROISSANT));
    expect(w, 'a fat-finger extra zero must warn').toBeTruthy();
    expect(w).toMatch(/175 kg/);
  });

  test('batchWarning: flags on absolute weight OR on the multiple of the recipe', () => {
    expect(warn(m.MAX_SANE_BATCH_G + 1, 50000)).toBeTruthy();
    expect(warn(m.MAX_SANE_BATCH_G, 50000), 'exactly at the line: fine').toBe(null);
    expect(warn(m.MAX_SANE_MULTIPLE * 100 + 100, 100)).toBeTruthy();
    expect(warn(m.MAX_SANE_MULTIPLE * 100, 100)).toBe(null);
  });

  test('batchWarning: with no recipe to compare to, the shorter sentence is used', () => {
    expect(warn(175000, 0)).toBe('That is 175 kg of dough. Check the amount before calculating.');
    expect(warn(175000, 'junk')).toBe('That is 175 kg of dough. Check the amount before calculating.');
  });

  test('scaleCatalogue: the scaling itself was never wrong — it reproduces the screenshot', () => {
    const rows = m.scaleCatalogue(CROISSANT, 17500000);
    expect(rows).toStrictEqual([9100543, 1180845, 183000, 364764, 1817636, 2411150, 624426, 1817636]);
    expect(sum(rows), 'and they sum EXACTLY').toBe(17500000);
    expect(sum(m.scaleCatalogue(CROISSANT, 17500))).toBe(17500);
  });

  test('the batch limits and the shelf-life ceiling are the original numbers', () => {
    expect(m.MAX_SANE_BATCH_G).toBe(100000);
    expect(m.MAX_SANE_MULTIPLE).toBe(50);
    expect(m.MAX_SHELF_LIFE_DAYS).toBe(3650);
  });

  // ── The chooser (step 3d-6) ────────────────────────────────────────────────

  test('⚠️ packaging is never offered as a recipe ingredient (the chooser half)', () => {
    const ingredients = {
      ...INGREDIENTS,
      BOX: { id: 'BOX', name: 'Burro box', kind: 'packaging', supplierId: 'S1' },
    };
    const all = m.linkOptions({ ingredients, recipes: [], suppliers: SUPPLIERS, query: '' }).ingredients.map(i => i.id);
    expect(all.includes('BOX'), 'the chooser leaves packaging out').toBe(false);
    expect(all.includes('B1'), 'and still lists the real ingredients').toBe(true);
  });

  test('the chooser shows the display name, searches both names, and still HANDS BACK the invoice name', () => {
    const ingredients = {
      f: { id: 'f', name: 'Caputo Rosso 00', shortName: 'Farina', weight: '25kg', supplierId: 'S1', active: true, unit: 'sacco' },
      b: { id: 'b', name: 'Butter', weight: '1kg', supplierId: 'S1', active: true, unit: '' },
    };
    const all = m.linkOptions({ ingredients, query: '' }).ingredients;
    const flour = all.find(o => o.id === 'f');
    expect(flour?.displayName).toBe('Farina');
    expect(flour?.name, 'the invoice name').toBe('Caputo Rosso 00');
    expect(m.linkOptions({ ingredients, query: 'farina' }).ingredients.map(o => o.id)).toStrictEqual(['f']);
    expect(m.linkOptions({ ingredients, query: 'caputo' }).ingredients.map(o => o.id)).toStrictEqual(['f']);
    const hits = m.suggestLinks({ ingredients, query: 'far' }).items;
    expect(hits[0]?.refId).toBe('f');
    expect(hits[0]?.displayName).toBe('Farina');
    expect(hits[0]?.name).toBe('Caputo Rosso 00');
    expect(m.suggestLinks({ ingredients, query: 'cap' }).items[0]?.refId).toBe('f');
  });

  test('the chooser: ingredients and recipes sorted, the recipe being edited left out, the supplier searched', () => {
    const out = m.linkOptions({ ingredients: INGREDIENTS, recipes: RECIPES, suppliers: SUPPLIERS, query: '', excludeRecipeId: 'SELF' });
    expect(out.ingredients.map(i => i.id), 'deactivated OLD is left out').toStrictEqual(['B2', 'B1', 'CR', 'F1', 'P1']);
    expect(out.recipes.map(r => r.id)).toStrictEqual(['R1']);
    expect(m.linkOptions({ ingredients: INGREDIENTS, suppliers: SUPPLIERS, query: 'brava' }).ingredients.map(i => i.id), 'the supplier is searched too')
      .toStrictEqual(['B1', 'F1', 'P1']);
    expect(m.linkOptions().ingredients).toStrictEqual([]);
    expect(m.linkOptions({ ingredients: null, recipes: 'x' }).recipes).toStrictEqual([]);
  });

  // ── Writing a row's link ───────────────────────────────────────────────────

  test('applyLink without a label: the typed name is left as it was (the old rule, for any other caller)', () => {
    const row = { label: 'burro', grams: 250, unit: 'g' };
    m.applyLink(row, { kind: 'ingredient', refId: 'B1', name: 'Burro Occelli' });
    expect(row).toStrictEqual({ label: 'burro', grams: 250, unit: 'g', kind: 'ingredient', refId: 'B1' });
  });

  test('⚠️⚠️ a pick sets the name to the one the link line shows — what was typed is overwritten (9 Oct 2026)', () => {
    const row = { label: 'burro', grams: 250, unit: 'g' };
    m.applyLink(row, { kind: 'ingredient', refId: 'B1', name: 'Burro Président' }, { label: 'Burro P.' });
    expect(row).toStrictEqual({ label: 'Burro P.', grams: 250, unit: 'g', kind: 'ingredient', refId: 'B1' });
    const plain = { label: 'burro' };
    m.applyLink(plain, { kind: 'ingredient', refId: 'B2', name: 'Burro Occelli' }, { label: 'Burro Occelli' });
    expect(plain.label, 'no short name: the ingredient name').toBe('Burro Occelli');
    const rec: Record<string, unknown> = { label: 'crema' };
    m.applyLink(rec, { kind: 'recipe', refId: 'R1', name: 'Crema al burro' }, { label: 'Crema al burro' });
    expect(rec.label).toBe('Crema al burro');
    expect(rec.kind).toBe('recipe');
  });

  test('applyLink mutates the row it is given and hands back that very object', () => {
    const row = { label: 'x' };
    expect(m.applyLink(row, { kind: 'ingredient', refId: ' B1 ' })).toBe(row);
    expect((row as Record<string, unknown>).refId, 'the id is trimmed').toBe('B1');
  });

  test('an empty label option, or a choice that is not one, never blanks or renames the row', () => {
    const row = { label: 'burro', kind: 'ingredient', refId: 'B1' };
    m.applyLink(row, { kind: 'ingredient', refId: 'B2', name: 'X' }, { label: '  ' });
    expect(row.label).toBe('burro');
    m.applyLink(row, { kind: 'supplier', refId: 'S1' }, { label: 'Nope' });
    expect(row.label).toBe('burro');
    expect(row.refId).toBe('B2');
  });

  test('a row with no name at all takes the chosen one', () => {
    for (const label of ['', '   ', undefined]) {
      const row: Record<string, unknown> = { label, grams: '', unit: 'g' };
      m.applyLink(row, { kind: 'recipe', refId: 'R1', name: 'Crema al burro' });
      expect(row.label).toBe('Crema al burro');
      expect(row.kind).toBe('recipe');
    }
  });

  test('applyLink(null) removes the link and keeps the name', () => {
    const row = { label: 'burro', kind: 'ingredient', refId: 'B1' };
    m.applyLink(row, null, { label: 'Burro P.' });
    expect(row).toStrictEqual({ label: 'burro' });
  });

  test('a choice that is not one changes nothing', () => {
    for (const junk of [undefined, {}, { kind: 'supplier', refId: 'S1' }, { kind: 'ingredient', refId: '  ' }]) {
      const row = { label: 'burro', kind: 'ingredient', refId: 'B1' };
      m.applyLink(row, junk);
      expect(row, JSON.stringify(junk)).toStrictEqual({ label: 'burro', kind: 'ingredient', refId: 'B1' });
    }
    expect(m.applyLink(null, { kind: 'ingredient', refId: 'B1' })).toBe(null);
  });

  test('linkedItemName: the one name a link line shows and a pick sets', () => {
    const ingredients = { B1: { id: 'B1', name: 'Burro Président', shortName: 'Burro P.' }, B2: { id: 'B2', name: 'Burro Occelli' } };
    const recipes = [{ id: 'R1', name: 'Crema al burro' }];
    expect(m.linkedItemName({ kind: 'ingredient', refId: 'B1', name: 'Burro Président' }, ingredients, recipes)).toBe('Burro P.');
    expect(m.linkedItemName({ kind: 'ingredient', refId: 'B2', name: 'x' }, ingredients, recipes)).toBe('Burro Occelli');
    expect(m.linkedItemName({ kind: 'recipe', refId: 'R1' }, ingredients, recipes)).toBe('Crema al burro');
    expect(m.linkedItemName({ kind: 'ingredient', refId: 'NEW', name: 'Lievito' }, ingredients, recipes), 'not loaded yet: the chosen name').toBe('Lievito');
    expect(m.linkedItemName({ kind: 'ingredient', refId: 'GONE' }, ingredients, recipes), 'nothing to show').toBe('');
    expect(m.linkedItemName({ kind: 'recipe', refId: 'GONE' }, ingredients, recipes)).toBe('');
    expect(m.linkedItemName({ kind: 'recipe', refId: 'GONE', name: ' Old copy ' }, ingredients, recipes), 'a recipe that is gone falls back to the chosen name').toBe('Old copy');
    expect(m.linkedItemName({ kind: 'supplier', refId: 'B1', name: 'x' }, ingredients, recipes), 'not a kind a row can link to').toBe('');
    expect(m.linkedItemName(null, ingredients, recipes)).toBe('');
    expect(m.linkedItemName('B1', ingredients, recipes)).toBe('');
    expect(m.linkedItemName({ kind: 'ingredient', refId: 'B1' }, null, null), 'no stores loaded yet').toBe('');
  });

  test('⚠️ choosing the link a row already has is not a new pick: it must not rename the row', () => {
    const ing = { kind: 'ingredient', refId: 'B1' };
    expect(m.isSameLink(ing, { kind: 'ingredient', refId: 'B1', name: 'Burro' })).toBe(true);
    expect(m.isSameLink(ing, { kind: 'ingredient', refId: 'B2' })).toBe(false);
    expect(m.isSameLink(ing, { kind: 'recipe', refId: 'B1' }), 'same id, other kind').toBe(false);
    expect(m.isSameLink(null, ing), 'a row with no link: every pick is new').toBe(false);
    expect(m.isSameLink(ing, null)).toBe(false);
    expect(m.isSameLink({ kind: 'ingredient', refId: 7 }, { kind: 'ingredient', refId: '7' }), 'a number id is read as text').toBe(true);
  });

  // ── moveRow ────────────────────────────────────────────────────────────────

  test('a row moves to its new place, and the others close up around it', () => {
    const [a, b, c, d] = ['flour', 'water', 'salt', 'yeast'].map(label => ({ label }));
    expect(m.moveRow([a, b, c, d], 0, 2).map(r => r?.label)).toStrictEqual(['water', 'salt', 'flour', 'yeast']);
    expect(m.moveRow([a, b, c, d], 3, 0).map(r => r?.label)).toStrictEqual(['yeast', 'flour', 'water', 'salt']);
  });

  test('⚠️⚠️ the SAME row objects move, so a row keeps its link and its rid — the step that points at it', () => {
    const flour = { label: 'flour', rid: 'r1', kind: 'ingredient', refId: 'FLOUR' };
    const water = { label: 'water', rid: 'r2' };
    const out = m.moveRow<Record<string, unknown>>([flour, water], 0, 1);
    expect(out[1], 'not a copy: the very row').toBe(flour);
    expect(out[1]?.rid).toBe('r1');
    expect(out[1]?.refId).toBe('FLOUR');
  });

  test('a move that goes nowhere, or off the end, changes nothing and never throws', () => {
    const rows = [{ label: 'a' }, { label: 'b' }];
    for (const [from, to] of [[0, 0], [-1, 0], [0, 2], [5, 1], ['x', 1], [null, undefined]]) {
      expect(m.moveRow(rows, from, to), `${from} → ${to}`).toStrictEqual(rows);
    }
    expect(m.moveRow(rows, 0, 1), 'a new list, never the one it was given').not.toBe(rows);
    expect(m.moveRow(rows, 0, 0), 'also when nothing moves').not.toBe(rows);
    expect(m.moveRow(null, 0, 1)).toStrictEqual([]);
  });

  // ── The editor's validation ────────────────────────────────────────────────

  test('findInvalidRecipe flags blank name and no-named-ingredient, passes valid', () => {
    expect(m.findInvalidRecipe({ name: '', ingredients: [{ label: 'Flour', grams: 1 }] })).toBe('name');
    expect(m.findInvalidRecipe({ name: 'X', ingredients: [] })).toBe('ingredients');
    expect(m.findInvalidRecipe({ name: 'X', ingredients: [{ label: '  ', grams: 1 }] })).toBe('ingredients');
    expect(m.findInvalidRecipe(FOCACCIA)).toBe(null);
  });

  test('findInvalidRecipe flags an all-zero-weight recipe (cannot be scaled)', () => {
    expect(m.findInvalidRecipe({ name: 'X', ingredients: [{ label: 'Flour', grams: 0 }] })).toBe('weight');
    expect(m.findInvalidRecipe({ name: 'X', ingredients: [{ label: 'Flour', grams: 0 }, { label: 'Salt', grams: 0 }] })).toBe('weight');
    expect(m.findInvalidRecipe({ name: 'X', ingredients: [{ label: 'Flour', grams: 5 }] })).toBe(null);
  });

  test('findInvalidRecipe is junk-safe, and the name is checked first', () => {
    for (const odd of [null, undefined, '', 0, {}, { name: '  ' }]) expect(m.findInvalidRecipe(odd), String(odd)).toBe('name');
    expect(m.findInvalidRecipe({ name: 'X' })).toBe('ingredients');
    expect(m.findInvalidRecipe({ name: 'X', ingredients: [null, 5 as never, { label: 'A', grams: 'x' }] }), 'a non-number amount is 0').toBe('weight');
    expect(m.findInvalidRecipe({ name: 'X', ingredients: [{ label: 'Salt', grams: 1, unit: 'to taste' }] }), 'any unit counts').toBe(null);
  });

  // ── The delete warning (drives the «was this imported?» question) ──────────

  test('findCalculatorImport finds the imported copy by its cat-<id> provenance id', () => {
    const cfg = { recipes: [{ id: 'brioche' }, { id: 'cat-foc', name: 'Focaccia' }] };
    expect(m.findCalculatorImport(cfg, 'foc')).toBe(cfg.recipes[1]);
  });

  test('findCalculatorImport returns null when the recipe was never imported', () => {
    expect(m.findCalculatorImport({ recipes: [{ id: 'brioche' }, { id: 'cat-other' }] }, 'foc')).toBe(null);
  });

  test('findCalculatorImport is junk-safe (null config / missing recipes -> null)', () => {
    expect(m.findCalculatorImport(null, 'foc')).toBe(null);
    expect(m.findCalculatorImport({}, 'foc')).toBe(null);
    expect(m.findCalculatorImport({ recipes: 'x' }, 'foc')).toBe(null);
    expect(m.findCalculatorImport({ recipes: [null, 5, { id: 'cat-foc' }] }, 'foc')).toStrictEqual({ id: 'cat-foc' });
  });
});

// ── nameTaken: the port against js/catalogue/ingredient-suggest.js ───────────

describe.each([
  ['shared/ (TypeScript)', ported.nameTaken],
  ['js/ (current app: ingredient-suggest.js)', legacyNameTaken as typeof ported.nameTaken],
] as const)('nameTaken — %s', (_name, nameTaken) => {
  test('an ingredient of exactly that name already on file is not offered again', () => {
    const map = { a: { name: 'Burro' }, b: { name: 'Strong flour' } };
    expect(nameTaken(map, ' burro '), 'case and the spaces at the ends do not make a new ingredient').toBe(true);
    expect(nameTaken(Object.values(map), 'STRONG FLOUR'), 'a list works as well as the map').toBe(true);
    expect(nameTaken(map, 'Burro salato')).toBe(false);
    expect(nameTaken(null, 'Burro')).toBe(false);
    expect(nameTaken({ x: null, y: {} }, 'Burro')).toBe(false);
  });

  test('⚠️ ONLY WHAT A ROW CAN BE LINKED TO: a switched-off ingredient or a box does not count', () => {
    expect(nameTaken({ a: { name: 'Burro', active: false } }, 'Burro')).toBe(false);
    expect(nameTaken({ a: { name: 'Burro', kind: 'packaging' } }, 'Burro')).toBe(false);
    expect(nameTaken({ a: { name: 'Burro', kind: 'ingredient', active: true } }, 'Burro')).toBe(true);
    expect(nameTaken({ a: { name: 'Burro', active: 0 } }, 'Burro'), 'only an explicit false switches it off').toBe(true);
  });

  test('a short name counts too, and so does the invoice name', () => {
    const flour = { f: { id: 'f', name: 'Caputo Rosso 00', shortName: 'Farina', active: true } };
    expect(nameTaken(flour, 'farina')).toBe(true);
    expect(nameTaken(flour, 'Caputo Rosso 00')).toBe(true);
    expect(nameTaken(flour, 'Burro')).toBe(false);
    expect(nameTaken({ a: { name: 'Burro', shortName: ' Bur ' } }, 'bur'), 'the short name is trimmed').toBe(true);
  });

  test('exactly that name — not a part of it — and any junk is simply «not taken»', () => {
    expect(nameTaken({ a: { name: 'Burro salato' } }, 'burro')).toBe(false);
    expect(nameTaken({ a: { name: 'Burro' } }, undefined), 'QUIRK COPIED: a blank name matches the missing short name, so the callers guard against a blank').toBe(true);
    expect(nameTaken({ a: { name: 'Burro', shortName: 'Bur' } }, undefined), 'with both names filled, a blank matches nothing').toBe(false);
    expect(nameTaken({ a: { id: 'a' } }, '  '), 'a nameless ingredient equals a blank name (copied quirk)').toBe(true);
    expect(nameTaken(undefined, 'x')).toBe(false);
    expect(nameTaken('abc', 'a')).toBe(false);
    expect(nameTaken(5, 'x')).toBe(false);
    expect(nameTaken({ a: { name: 5 } }, '5'), 'a number name is read as text').toBe(true);
  });
});

// ── What a person reads for a unit ───────────────────────────────────────────
// ADAPTED from tests/recipe-unit-text.test.mjs: the original `unitText(unit)` against the port's `unitTextKey`
// (key, then the dictionary — or the unit itself for a metric symbol), in each language.

describe('unitText (the original) against unitTextKey (the port)', () => {
  const portedText = (unit: unknown): unknown => {
    const key = ported.unitTextKey(unit);
    return key ? t(key) : unit;
  };
  const legacyText = (unit: unknown): unknown => (legacyJs as unknown as { unitText: (u: unknown) => unknown }).unitText(unit);

  function inLanguage<R>(lang: string, fn: () => R): R {
    setLanguage(lang);
    try { return fn(); } finally { setLanguage(DEFAULT_LANGUAGE); }
  }

  describe.each([['shared/ (TypeScript)', portedText], ['js/ (current app)', legacyText]] as const)('%s', (_name, unitText) => {
    test('an Italian venue reads its units in Italian', () => {
      inLanguage('it', () => {
        expect(unitText('to taste')).toBe('q.b.');
        expect(unitText('pinch')).toBe('pizz.');
        expect(unitText('pcs')).toBe('pz');
      });
    });

    // ⚠️⚠️ THE EDITOR'S UNIT BOX LEAVES 41.2px FOR THE WORD. Measured widths of what ships, so a longer word is
    // a decision: q.b. 24.07 · pz 15.86 · pizz. 30.79 · tbsp 30.30 · tsp 21.85
    test('⚠️ every Italian unit label is one that was measured to fit the editor', () => {
      const MEASURED = new Map<unknown, number>([['q.b.', 24.07], ['pz', 15.86], ['pizz.', 30.79], ['tbsp', 30.30], ['tsp', 21.85]]);
      inLanguage('it', () => {
        for (const unit of ported.CATALOGUE_UNITS.filter(u => /[a-z]{2}/.test(u) && !/^(mg|ml|cl|dl|kg)$/.test(u))) {
          const label = unitText(unit);
          expect(MEASURED.has(label), `«${String(label)}» (${unit}) was never measured against the 41.2px box`).toBe(true);
          expect(MEASURED.get(label) as number).toBeLessThanOrEqual(41.2);
        }
        expect(unitText('tsp')).not.toBe(unitText('tbsp'));
      });
    });

    test('an English venue reads exactly what it always read', () => {
      inLanguage('en', () => {
        for (const unit of ported.CATALOGUE_UNITS) expect(unitText(unit)).toBe(unit);
      });
    });

    test('the metric symbols are the same in every language', () => {
      inLanguage('it', () => {
        for (const unit of ['g', 'kg', 'mg', 'ml', 'cl', 'dl', 'l']) expect(unitText(unit)).toBe(unit);
      });
    });

    test('an unknown word comes back as it is', () => {
      for (const odd of ['nope', '', 5, null, undefined]) expect(unitText(odd)).toBe(odd);
    });
  });

  test('⚠️ the stored units stay identifiers, protected as data words', () => {
    for (const unit of ['pcs', 'tsp', 'tbsp', 'pinch', 'to taste']) {
      expect((DATA_WORDS as readonly string[]).includes(unit), `${unit} must be a DATA_WORD`).toBe(true);
    }
  });

  test('every key unitTextKey answers exists in both dictionaries', () => {
    const dicts = _dictionaries() as Record<string, Record<string, unknown>>;
    for (const unit of ported.CATALOGUE_UNITS) {
      const key = ported.unitTextKey(unit);
      if (key) for (const lang of Object.keys(dicts)) expect(dicts[lang]?.[key], `${key} in ${lang}`).toBeTruthy();
    }
    expect(ported.unitTextKey('g')).toBe(null);
    expect(ported.unitTextKey('toString'), 'a name on the prototype is not a unit').toBe(null);
  });
});

// ── A quirk copied, not tidied ───────────────────────────────────────────────

describe('QUIRK COPIED: ingredientGrams of nothing', () => {
  test.each([['shared/ (TypeScript)', ported], ['js/ (current app)', legacy]] as const)(
    '%s throws a TypeError for a null or undefined row (unitOf answers «g», then `.grams` is read off nothing)',
    (_name, m) => {
      expect(() => m.ingredientGrams(null)).toThrow(TypeError);
      expect(() => m.ingredientGrams(undefined)).toThrow(TypeError);
      expect(() => m.weighableTotalGrams({ ingredients: [null] })).toThrow(TypeError);
    });
});

// ── kg and litres keep their decimals (14 Oct 2026, the current app's PR #361) ──

describe('kg and litre decimals', () => {
  // Made up: 0.4 kg flour + 1.25 l milk + 2 eggs + salt to taste = 1650 g weighable.
  const MIXED = { ingredients: [
    { label: 'Farina di prova', grams: 0.4, unit: 'kg' },
    { label: 'Latte di prova', grams: 1.25, unit: 'l' },
    { label: 'Uova di prova', grams: 2, unit: 'pcs' },
    { label: 'Sale di prova', grams: 0, unit: 'to taste' },
  ] };

  test('only kg, l, dl and cl have decimals, down to one gram or millilitre', () => {
    expect(['kg', 'l', 'dl', 'cl', 'g', 'mg', 'ml', 'pcs', 'tsp', 'to taste'].map(ported.unitDecimals))
      .toStrictEqual([3, 3, 2, 1, 0, 0, 0, 0, 0, 0]);
    expect(ported.roundInUnit(1.8375, 'kg')).toBe(1.838);
    expect(ported.roundInUnit(2.345, 'dl')).toBe(2.35);
    expect(ported.roundInUnit(2.4, 'g')).toBe(2);
    expect(ported.roundInUnit('junk', 'kg'), 'never NaN').toBe(0);
  });

  test('⚠️ the base recipe keeps 0.4 kg and 1.25 l (they read «0 kg» and «1 l»)', () => {
    expect(ported.baseAmounts(MIXED)).toStrictEqual([0.4, 1.25, 2, null]);
  });

  test('⚠️ scaled, kg and l keep their decimals (3000 g: 0.727 kg, 2.273 l)', () => {
    expect(ported.scaleCatalogue(MIXED, 3000)).toStrictEqual([0.727, 2.273, 4, null]);
  });

  test('the same numbers as the current app', () => {
    for (const target of [0, 1000, 3000, 7777]) {
      expect(ported.scaleCatalogue(MIXED, target), String(target)).toStrictEqual(legacy.scaleCatalogue(MIXED, target));
    }
    expect(ported.baseAmounts(MIXED)).toStrictEqual(legacy.baseAmounts(MIXED));
  });
});

// ── What pairing would have checked ──────────────────────────────────────────

describe('the port against the original', () => {
  // The rest of the original: the Calculator import (step 3d-7), `unitText`, which the port replaces by `unitTextKey`, and `formatAmount`, which needs the interface
  // language and so lives in the app (app/src/recipes/recipeAmounts.ts `amountNumber`), and `exportModelOf`, which
  // reads both of those (the unit word and the screen's number): the app builds the export model from its own
  // typed i18n, in the export slice.
  const LEFT_OUT = [
    'unitText', 'formatAmount', 'toCalculatorRecipe', 'nonWeighableLabels', 'mergeImportedRecipe', 'importFailureKey',
    'exportModelOf',
  ];
  // `nameTaken` is not an export of catalogue-model.js: its original is in ingredient-suggest.js (tested above).
  const ADDED = ['unitTextKey', 'nameTaken'];
  // Same name, same results, but the translator is one more parameter.
  const ARITY_DIFFERS = ['batchWarning'];
  const original = legacyJs as unknown as Record<string, unknown>;
  const port = ported as unknown as Record<string, unknown>;
  const shared = Object.keys(original).filter(name => !LEFT_OUT.includes(name)).sort();

  test('the original still exports everything this port leaves out', () => {
    // If it did not, the exclusion above would be hiding a rename instead of a decision.
    for (const name of LEFT_OUT) expect(original[name] !== undefined, name).toBe(true);
  });

  test('exports exactly the same names, except those', () => {
    expect(Object.keys(port).sort()).toStrictEqual([...shared, ...ADDED].sort());
  });

  test('every non-function export is strictly equal and frozen the same way', () => {
    for (const name of shared) {
      if (typeof original[name] === 'function') continue;
      expect(port[name], name).toStrictEqual(original[name]);
      expect(Object.isFrozen(port[name]), `${name}: frozen`).toBe(Object.isFrozen(original[name]));
    }
  });

  test('every function has the same name and the same number of required parameters', () => {
    for (const name of shared) {
      const mine = port[name];
      const theirs = original[name];
      if (typeof mine !== 'function' || typeof theirs !== 'function') continue;
      expect(mine.name, name).toBe(theirs.name);
      const expected = ARITY_DIFFERS.includes(name) ? theirs.length + 1 : theirs.length;
      expect(mine.length, `${name}: arity`).toBe(expected);
    }
  });
});
