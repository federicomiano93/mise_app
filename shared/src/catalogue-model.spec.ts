// Unit tests for the part of the recipe catalogue's model that Food cost reads (P15 — the owner cannot
// read code, so these tests are the safety net), run against BOTH implementations: the TypeScript port in
// shared/ and js/catalogue/catalogue-model.js, which the live app uses today. Ported from
// tests/catalogue-model.test.mjs, tests/link-suggestions.test.mjs and tests/recipe-cost-model.test.mjs;
// the two must stay equal until the switch to Mise 2.
//
// catalogue-model.ts is a PARTIAL port, so parity.spec.ts does not pair it: the original also holds the
// recipe normalisers, the kg scaling, the Calculator import and three functions that look a word up in
// the interface dictionary. The last block of this file stands in for what pairing would have checked:
// the same names, the same constants, the same frozen-ness, the same function shapes.
//
// PORTED from tests/catalogue-model.test.mjs: 'unitOf / isWeighableUnit / weighableTotalGrams' and the
// weighing tests ('two weighings become a percentage', '⚠️ the number SHOWN is the number STORED…',
// '⚠️⚠️ nothing gains weight in an oven…', '⚠️⚠️ a cooked weight of almost nothing is capped at 99…',
// '⚠️ an unanswered pair is null…', 'junk in, no throw and no NaN out'); from
// tests/link-suggestions.test.mjs: every test of suggestLinks (nothing below two characters, «burro»,
// starts-with / word / inside, accents, the NAME only, deactivated and the recipe being edited, at most
// five, ingredients before recipes, what each suggestion carries) and the suggestLinks half of
// '⚠️ packaging is never offered as a recipe ingredient'; from tests/recipe-cost-model.test.mjs:
// 'a loss of 100% cannot divide the price by zero' (the normalizeLossPct half), 'a nonsense loss is
// treated as none' and 'a junk link is treated as no link…'. Added: normalizeSearchText, ingredientGrams
// (including the copied quirk) and the constants.
//
// NOT PORTED — the other half of the original: every test of normalizeCatalogueRecipe(s), scaleCatalogue,
// baseAmounts, formatWeight, batchWarning, isScaledEntryFresh, sortByUsage, filterByName,
// findInvalidRecipe, toCalculatorRecipe, nonWeighableLabels, mergeImportedRecipe, findCalculatorImport
// (tests/catalogue-model.test.mjs, 40 of its 48); '⚠️ the weights are absent, not zero…' (it reads
// normalizeCatalogueRecipe); tests/link-suggestions.test.mjs' applyLink, linkedItemName, isSameLink and
// linkOptions tests, and the ones that read the screens' source or the precache.

import { describe, expect, test } from 'vitest';
import * as ported from './catalogue-model';
import * as legacyJs from '../../js/catalogue/catalogue-model.js';

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

// ── What pairing would have checked ──────────────────────────────────────────

describe('the port against the original', () => {
  // The other half of the original: recipe normalisers, list helpers, the kg scaling, the Calculator import
  // and the functions that look a word up in the interface dictionary. `unitDecimals` / `roundInUnit` belong
  // to the kg scaling (live fix «kg and litre amounts keep their decimals»), `formatAmount` reads the interface
  // locale: all three come with the scaling, in step 3d.
  const LEFT_OUT = [
    'unitText', 'unitDecimals', 'roundInUnit', 'formatAmount', 'normalizeCatalogueRecipe', 'normalizeCatalogueRecipes', 'labelFieldsOf', 'normalizeShelfLifeDays',
    'MAX_SHELF_LIFE_DAYS', 'sortByUsage', 'filterByName', 'linkOptions', 'linkedItemName', 'isSameLink', 'applyLink',
    'moveRow', 'scaleCatalogue', 'baseAmounts', 'MAX_SANE_BATCH_G', 'MAX_SANE_MULTIPLE', 'formatWeight',
    'batchWarning', 'SCALED_TTL_MS', 'isScaledEntryFresh', 'findInvalidRecipe', 'toCalculatorRecipe',
    'nonWeighableLabels', 'mergeImportedRecipe', 'importFailureKey', 'findCalculatorImport',
  ];
  const original = legacyJs as unknown as Record<string, unknown>;
  const port = ported as unknown as Record<string, unknown>;
  const shared = Object.keys(original).filter(name => !LEFT_OUT.includes(name)).sort();

  test('the original still exports everything this port leaves out', () => {
    // If it did not, the exclusion above would be hiding a rename instead of a decision.
    for (const name of LEFT_OUT) expect(original[name] !== undefined, name).toBe(true);
  });

  test('exports exactly the same names, except those', () => {
    expect(Object.keys(port).sort()).toStrictEqual(shared);
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
      expect(mine.length, `${name}: arity`).toBe(theirs.length);
    }
  });
});
